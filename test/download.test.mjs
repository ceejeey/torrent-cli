import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import WebTorrent from 'webtorrent';
import { download } from '../src/download.mjs';
import { parseOptions } from '../src/options.mjs';

const clientOptions = {
  dht: false,
  tracker: false,
  lsd: false,
  utPex: false,
  natUpnp: false,
  natPmp: false,
  utp: false,
};
const reporter = { log() {}, progress() {}, interval: 100 };

test(
  'downloads via local peers, resumes verified files, and handles stop/errors',
  { timeout: 30000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'torrent-cli-'));
    const seed = new WebTorrent(clientOptions);
    t.after(async () => {
      if (!seed.destroyed) await new Promise((resolve) => seed.destroy(resolve));
      await rm(root, { recursive: true, force: true });
    });
    const payload = randomBytes(256 * 1024);
    const source = join(root, 'fixture.bin');
    await writeFile(source, payload);
    const torrent = await new Promise((resolve, reject) => {
      seed.once('error', reject);
      seed.seed(source, { announce: [] }, resolve);
    });
    const torrentFile = join(root, 'fixture.torrent');
    await writeFile(torrentFile, torrent.torrentFile);
    const peer = `127.0.0.1:${seed.torrentPort}`;
    const settings = { clientOptions, reporter, signal: globalThis.AbortSignal.timeout(10000) };

    for (const [index, input] of [
      torrentFile,
      `magnet:?xt=urn:btih:${torrent.infoHash}`,
    ].entries()) {
      const output = join(root, `download-${index}`);
      const options = parseOptions([input, '-o', output, '--peer', peer]);
      assert.equal(await download(options, settings), 0);
      const downloaded = join(
        output,
        `${torrent.name} - ${torrent.infoHash.slice(0, 8)}`,
        'fixture.bin',
      );
      assert.deepEqual(await readFile(downloaded), payload);
      // Completed data must remain valid and finish without a connected peer.
      const resume = parseOptions([torrentFile, '-o', output]);
      assert.equal(await download(resume, settings), 0);
      assert.deepEqual(await readFile(downloaded), payload);
    }

    // Force an interrupted partial transfer, then verify it can be resumed.
    const output = join(root, 'partial');
    const partial = parseOptions([
      torrentFile,
      '-o',
      output,
      '--peer',
      peer,
      '--download-limit',
      '64',
    ]);
    const controller = new globalThis.AbortController();
    let received = 0;
    assert.equal(
      await download(partial, {
        clientOptions,
        signal: controller.signal,
        reporter: {
          ...reporter,
          progress(active) {
            received = active.downloaded;
            if (received > 0) controller.abort();
          },
        },
      }),
      130,
    );
    assert.ok(received > 0 && received < payload.length);
    assert.equal(await download({ ...partial, downloadLimit: -1 }, settings), 0);
    assert.deepEqual(
      await readFile(
        join(output, `${torrent.name} - ${torrent.infoHash.slice(0, 8)}`, 'fixture.bin'),
      ),
      payload,
    );

    const badFile = join(root, 'invalid.torrent');
    await writeFile(badFile, 'invalid torrent metadata');
    assert.equal(await download(parseOptions([badFile, '-o', join(root, 'invalid')]), settings), 1);

    const absent = `magnet:?xt=urn:btih:${'a'.repeat(40)}`;
    assert.equal(
      await download(
        parseOptions([absent, '-o', join(root, 'timeout'), '--metadata-timeout', '1']),
        settings,
      ),
      1,
    );

    const seeding = new globalThis.AbortController();
    assert.equal(
      await download(
        { ...partial, downloadLimit: -1, seed: true },
        {
          clientOptions,
          signal: seeding.signal,
          reporter: {
            ...reporter,
            log(message) {
              if (message.startsWith('Download complete. Seeding')) seeding.abort();
            },
          },
        },
      ),
      130,
    );
  },
);
