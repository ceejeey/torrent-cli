import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import process from 'node:process';
import { URL } from 'node:url';
import { parseOptions } from '../src/options.mjs';

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
  assert.equal(options.uploadLimit, 256);
  assert.equal(options.downloadLimit, -1);
  assert.deepEqual(options.peers, ['127.0.0.1:6881']);
});

test('rejects missing, ambiguous, malformed and unsupported input', () => {
  for (const args of [
    [],
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

test('help and missing-file errors work through the executable', () => {
  const cli = new URL('../src/cli.mjs', import.meta.url);
  const help = spawnSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: torrent-dl/);
  const missing = spawnSync(process.execPath, [cli.pathname, '/nonexistent/absent.torrent'], {
    encoding: 'utf8',
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ENOENT/);
});
