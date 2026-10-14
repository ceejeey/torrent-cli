import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { createReporter } from './progress.mjs';

async function applyFileSelection(torrent, selectedPaths) {
  if (!selectedPaths?.length) return;
  const chosen = new Set(selectedPaths);
  for (const file of torrent.files) file.deselect();
  for (const file of torrent.files) {
    if (chosen.has(file.path)) file.select();
  }
}

/** Progress snapshot scoped to selected files when a subset is downloading. */
function progressSnapshot(torrent, selectedPaths) {
  if (!selectedPaths?.length) return torrent;
  const chosen = new Set(selectedPaths);
  const files = torrent.files.filter((file) => chosen.has(file.path));
  const length = files.reduce((sum, file) => sum + file.length, 0);
  const downloaded = files.reduce((sum, file) => sum + file.downloaded, 0);
  return {
    progress: length > 0 ? downloaded / length : 0,
    downloaded,
    length,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    numPeers: torrent.numPeers,
  };
}

function selectedFilesDone(torrent, selectedPaths) {
  if (!selectedPaths?.length) return torrent.done;
  const chosen = new Set(selectedPaths);
  return torrent.files.filter((file) => chosen.has(file.path)).every((file) => file.done);
}

export async function download(
  options,
  {
    clientOptions = {},
    reporter = createReporter(),
    signal,
    selectFiles,
    seedRef = { seed: options.seed },
  } = {},
) {
  seedRef.seed = options.seed;
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
    let readyChain = Promise.resolve();
    let selectedPaths = null;

    function finish(code, message) {
      if (stopping) return;
      stopping = true;
      clearInterval(progressTimer);
      clearTimeout(metadataTimer);
      signal?.removeEventListener('abort', abort);
      reporter.log(message);
      const shutdown = async () => {
        await reporter.dispose?.();
        if (client.destroyed) return resolve(code);
        client.destroy((error) => {
          if (error) process.stderr.write(`Shutdown error: ${error.message}\n`);
          resolve(code);
        });
      };
      void shutdown();
    }

    function abort() {
      finish(130, 'Stopped. Downloaded data kept; rerun the same command to resume.');
    }

    function complete() {
      if (stopping || completed) return;
      completed = true;
      if (seedRef.seed) {
        reporter.log('Download complete. Seeding; press Ctrl+C or q to stop.');
      } else {
        finish(0, 'Download complete.');
      }
    }

    function watchCompletion(torrent) {
      if (!selectedPaths?.length) {
        torrent.once('done', () => {
          void readyChain.then(() => complete());
        });
        return;
      }
      const chosen = torrent.files.filter((file) => selectedPaths.includes(file.path));
      let remaining = chosen.length;
      const onFileDone = () => {
        remaining -= 1;
        if (remaining <= 0) complete();
      };
      for (const file of chosen) {
        if (file.done) onFileDone();
        else file.once('done', onFileDone);
      }
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
        readyChain = (async () => {
          if (stopping) return;
          clearTimeout(metadataTimer);

          if (selectFiles && torrent.files.length > 1) {
            await reporter.pause?.();
            try {
              selectedPaths = await selectFiles(torrent);
              if (selectedPaths) await applyFileSelection(torrent, selectedPaths);
            } finally {
              reporter.resume?.();
            }
          }

          if (stopping) return;
          watchCompletion(torrent);
          reporter.log(`Downloading: ${torrent.name}`);
          reporter.log(
            `Destination: ${join(options.output, `${torrent.name} - ${torrent.infoHash.slice(0, 8)}`)}`,
          );
          reporter.progress(progressSnapshot(torrent, selectedPaths));
          progressTimer = setInterval(() => {
            reporter.progress(progressSnapshot(torrent, selectedPaths));
            if (!completed && selectedFilesDone(torrent, selectedPaths)) complete();
            if (completed && !seedRef.seed && !stopping) {
              finish(0, 'Download complete.');
            }
          }, reporter.interval);
          if (selectedFilesDone(torrent, selectedPaths)) complete();
        })().catch((error) => {
          if (stopping) return;
          if (error?.exitCode === 130) finish(130, 'Cancelled.');
          else finish(1, `Error: ${error.message}`);
        });
      });
      torrent.on('noPeers', () => {
        if (!stopping && !torrent.done)
          reporter.log('Waiting for peers; leave running or press Ctrl+C / q to stop.');
      });
    } catch (error) {
      finish(1, `Error: ${error.message}`);
    }
  });
}
