import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
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

/** Shared local seeder and torrent fixture for focused download cases. */
const fixture = {};

before(async () => {
  const root = await mkdtemp(join(tmpdir(), 'torrent-cli-'));
  const seed = new WebTorrent(clientOptions);
  const payload = randomBytes(256 * 1024);
  const source = join(root, 'fixture.bin');
  await writeFile(source, payload);
  const torrent = await new Promise((resolve, reject) => {
    seed.once('error', reject);
    seed.seed(source, { announce: [] }, resolve);
  });
  const torrentFile = join(root, 'fixture.torrent');
  await writeFile(torrentFile, torrent.torrentFile);
  Object.assign(fixture, {
    root,
    seed,
    payload,
    torrent,
    torrentFile,
    peer: `127.0.0.1:${seed.torrentPort}`,
    settings: { clientOptions, reporter },
  });
});

function withTimeout(extra = {}) {
  return {
    ...fixture.settings,
    signal: globalThis.AbortSignal.timeout(10000),
    ...extra,
  };
}

after(async () => {
  if (fixture.seed && !fixture.seed.destroyed) {
    await new Promise((resolve) => fixture.seed.destroy(resolve));
  }
  if (fixture.root) await rm(fixture.root, { recursive: true, force: true });
});

function downloadedPath(output) {
  return join(
    output,
    `${fixture.torrent.name} - ${fixture.torrent.infoHash.slice(0, 8)}`,
    'fixture.bin',
  );
}

test('downloads a .torrent file via a local peer', { timeout: 15000 }, async () => {
  const output = join(fixture.root, 'download-file');
  const options = parseOptions([fixture.torrentFile, '-o', output, '--peer', fixture.peer]);
  assert.equal(await download(options, withTimeout()), 0);
  assert.deepEqual(await readFile(downloadedPath(output)), fixture.payload);
});

test('downloads a magnet link via a local peer', { timeout: 15000 }, async () => {
  const output = join(fixture.root, 'download-magnet');
  const magnet = `magnet:?xt=urn:btih:${fixture.torrent.infoHash}`;
  const options = parseOptions([magnet, '-o', output, '--peer', fixture.peer]);
  assert.equal(await download(options, withTimeout()), 0);
  assert.deepEqual(await readFile(downloadedPath(output)), fixture.payload);
});

test('resumes verified completed files without a peer', { timeout: 15000 }, async () => {
  const output = join(fixture.root, 'resume');
  const options = parseOptions([fixture.torrentFile, '-o', output, '--peer', fixture.peer]);
  assert.equal(await download(options, withTimeout()), 0);
  const resume = parseOptions([fixture.torrentFile, '-o', output]);
  assert.equal(await download(resume, withTimeout()), 0);
  assert.deepEqual(await readFile(downloadedPath(output)), fixture.payload);
});

test('stops mid-transfer and resumes the partial download', { timeout: 20000 }, async () => {
  const output = join(fixture.root, 'partial');
  const partial = parseOptions([
    fixture.torrentFile,
    '-o',
    output,
    '--peer',
    fixture.peer,
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
  assert.ok(received > 0 && received < fixture.payload.length);
  assert.equal(await download({ ...partial, downloadLimit: -1 }, withTimeout()), 0);
  assert.deepEqual(await readFile(downloadedPath(output)), fixture.payload);
});

test('returns 1 for invalid torrent metadata', { timeout: 10000 }, async () => {
  const badFile = join(fixture.root, 'invalid.torrent');
  await writeFile(badFile, 'invalid torrent metadata');
  assert.equal(
    await download(parseOptions([badFile, '-o', join(fixture.root, 'invalid')]), withTimeout()),
    1,
  );
});

test('returns 1 when metadata times out', { timeout: 10000 }, async () => {
  const absent = `magnet:?xt=urn:btih:${'a'.repeat(40)}`;
  assert.equal(
    await download(
      parseOptions([absent, '-o', join(fixture.root, 'timeout'), '--metadata-timeout', '1']),
      withTimeout(),
    ),
    1,
  );
});

test('seeds after completion until aborted', { timeout: 15000 }, async () => {
  const output = join(fixture.root, 'seed');
  const options = parseOptions([
    fixture.torrentFile,
    '-o',
    output,
    '--peer',
    fixture.peer,
    '--seed',
  ]);
  const seeding = new globalThis.AbortController();
  assert.equal(
    await download(
      { ...options, seed: true },
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
});

test('downloads only files returned by selectFiles', { timeout: 20000 }, async () => {
  const { mkdir } = await import('node:fs/promises');
  const multiRoot = join(fixture.root, 'multi-source');
  await mkdir(multiRoot, { recursive: true });
  const keep = randomBytes(64 * 1024);
  const skip = randomBytes(64 * 1024);
  await writeFile(join(multiRoot, 'keep.bin'), keep);
  await writeFile(join(multiRoot, 'skip.bin'), skip);
  const multiTorrent = await new Promise((resolve, reject) => {
    fixture.seed.once('error', reject);
    fixture.seed.seed(multiRoot, { announce: [] }, resolve);
  });
  const multiFile = join(fixture.root, 'multi.torrent');
  await writeFile(multiFile, multiTorrent.torrentFile);
  const peer = `127.0.0.1:${fixture.seed.torrentPort}`;
  const output = join(fixture.root, 'select-files');
  const options = parseOptions([multiFile, '-o', output, '--peer', peer]);
  assert.equal(
    await download(
      options,
      withTimeout({
        selectFiles: async (torrent) => {
          const keepFile = torrent.files.find((file) => file.name === 'keep.bin');
          assert.ok(keepFile);
          return [keepFile.path];
        },
      }),
    ),
    0,
  );
  const dest = join(output, `${multiTorrent.name} - ${multiTorrent.infoHash.slice(0, 8)}`);
  assert.deepEqual(await readFile(join(dest, 'multi-source', 'keep.bin')), keep);
  await assert.rejects(() => readFile(join(dest, 'multi-source', 'skip.bin')));
});

test('seedRef can disable seeding after completion', { timeout: 15000 }, async () => {
  const output = join(fixture.root, 'seed-toggle');
  const options = parseOptions([
    fixture.torrentFile,
    '-o',
    output,
    '--peer',
    fixture.peer,
    '--seed',
  ]);
  const seedRef = { seed: true };
  assert.equal(
    await download(
      { ...options, seed: true },
      {
        clientOptions,
        seedRef,
        signal: globalThis.AbortSignal.timeout(10000),
        reporter: {
          ...reporter,
          interval: 50,
          log(message) {
            if (message.startsWith('Download complete. Seeding')) seedRef.seed = false;
          },
        },
      },
    ),
    0,
  );
});
