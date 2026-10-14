import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { createReporter } from './progress.mjs';

export async function download(
  options,
  { clientOptions = {}, reporter = createReporter(), signal } = {},
) {
  const source = options.source.startsWith('magnet:')
    ? options.source
    : await readFile(options.source);
  await mkdir(options.output, { recursive: true });
  const { default: WebTorrent } = await import('webtorrent');
  if (signal?.aborted) return 130;

  return new Promise((resolve) => {
    const client = new WebTorrent({
      natUpnp: false,
      natPmp: false,
      downloadLimit: options.downloadLimit < 0 ? -1 : options.downloadLimit * 1024,
      uploadLimit: options.uploadLimit < 0 ? -1 : options.uploadLimit * 1024,
      ...clientOptions,
    });
    let stopping = false;
    let completed = false;
    let progressTimer;
    let metadataTimer;
    function finish(code, message) {
      if (stopping) return;
      stopping = true;
      clearInterval(progressTimer);
      clearTimeout(metadataTimer);
      signal?.removeEventListener('abort', abort);
      reporter.log(message);
      if (client.destroyed) return resolve(code);
      client.destroy((error) => {
        if (error) reporter.log(`Shutdown error: ${error.message}`);
        resolve(code);
      });
    }
    function abort() {
      finish(130, 'Stopped. Downloaded data kept; rerun the same command to resume.');
    }
    signal?.addEventListener('abort', abort, { once: true });
    client.on('error', (error) => finish(1, `Error: ${error.message}`));
    reporter.log('Finding peers and fetching metadata...');
    if (options.metadataTimeout > 0) {
      metadataTimer = setTimeout(() => {
        finish(1, 'Metadata timed out. Check the torrent/peers or increase --metadata-timeout.');
      }, options.metadataTimeout * 1000);
    }
    try {
      const torrent = client.add(source, {
        path: options.output,
        addUID: true,
        destroyStoreOnDestroy: false,
        strategy: 'rarest',
      });
      torrent.on('error', (error) => finish(1, `Error: ${error.message}`));
      torrent.once('infoHash', () => {
        for (const peer of options.peers) torrent.addPeer(peer);
      });
      torrent.once('metadata', () => clearTimeout(metadataTimer));
      torrent.once('ready', () => {
        if (stopping) return;
        clearTimeout(metadataTimer);
        reporter.log(`Downloading: ${torrent.name}`);
        reporter.log(
          `Destination: ${join(options.output, `${torrent.name} - ${torrent.infoHash.slice(0, 8)}`)}`,
        );
        reporter.progress(torrent);
        progressTimer = setInterval(() => reporter.progress(torrent), reporter.interval);
        if (torrent.done) complete();
      });
      function complete() {
        if (stopping || completed) return;
        completed = true;
        if (options.seed) {
          reporter.log('Download complete. Seeding; press Ctrl+C to stop.');
        } else {
          finish(0, 'Download complete.');
        }
      }
      torrent.once('done', complete);
      torrent.on('noPeers', () => {
        if (!stopping && !torrent.done)
          reporter.log('Waiting for peers; leave running or press Ctrl+C to stop.');
      });
    } catch (error) {
      finish(1, `Error: ${error.message}`);
    }
  });
}
