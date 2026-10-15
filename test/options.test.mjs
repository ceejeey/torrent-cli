import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import process from 'node:process';
import { URL } from 'node:url';
import { parseOptions, validateSource } from '../src/options.mjs';

const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}`;

test('accepts quoted magnets, output paths, limits and explicit peers', () => {
  const options = parseOptions([
    magnet,
    '-o',
    '/tmp/torrent-test',
    '--upload-limit',
    '256',
    '--peer',
    '127.0.0.1:6881',
  ]);
  assert.equal(options.source, magnet);
  assert.equal(options.output, '/tmp/torrent-test');
  assert.equal(options.outputExplicit, true);
  assert.equal(options.uploadLimit, 256);
  assert.equal(options.downloadLimit, -1);
  assert.equal(options.incomplete, false);
  assert.equal(options.selectFiles, true);
  assert.deepEqual(options.peers, ['127.0.0.1:6881']);
});

test('allows missing source for interactive fill-in', () => {
  const options = parseOptions(['-i']);
  assert.equal(options.source, null);
  assert.equal(options.incomplete, true);
  assert.equal(options.interactive, true);
  assert.equal(options.outputExplicit, false);
  assert.equal(options.selectFiles, true);
});

test('honors --no-select-files', () => {
  const options = parseOptions([magnet, '--no-select-files']);
  assert.equal(options.selectFiles, false);
  assert.equal(options.incomplete, false);
});

test('rejects ambiguous, malformed and unsupported input', () => {
  for (const args of [
    ['a.torrent', 'b.torrent'],
    ['magnet:?xt=bad'],
    ['file.txt'],
    [magnet, '--seed=false'],
    [magnet, '--upload-limit', '-2'],
    [magnet, '--peer', 'host:99999'],
  ]) {
    assert.throws(() => parseOptions(args));
  }
});

test('validateSource normalizes torrent paths and magnets', () => {
  assert.equal(validateSource(magnet), magnet);
  assert.match(validateSource('sample.torrent'), /sample\.torrent$/);
  assert.throws(() => validateSource('magnet:?xt=bad'));
});

test('help and missing-file errors work through the executable', () => {
  const cli = new URL('../src/cli.mjs', import.meta.url);
  const help = spawnSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: torrent-cli/);
  assert.match(help.stdout, /interactive/);
  const missing = spawnSync(process.execPath, [cli.pathname, '/nonexistent/absent.torrent'], {
    encoding: 'utf8',
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ENOENT/);
});
