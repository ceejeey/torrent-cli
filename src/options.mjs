import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { URL } from 'node:url';

export const help = `Usage: torrent-dl <magnet-link|file.torrent> [options]

Options:
  -o, --output <folder>       Download folder (default: ./downloads)
      --download-limit <n>   Download cap in KiB/s (default: unlimited)
      --upload-limit <n>     Upload cap in KiB/s (default: unlimited)
      --metadata-timeout <n> Seconds to wait for metadata (default: 120; 0 disables)
      --peer <host:port>     Connect to a peer directly (repeatable)
      --seed                 Keep seeding after completion
  -h, --help                 Show this help

Ctrl+C stops safely and keeps downloaded data. Run the same command to resume.
Files are stored inside a subfolder named with the torrent name and hash prefix.
Torrents upload to peers while downloading; --seed continues after completion.
Quote magnet links so your shell does not interpret their '&' characters.
`;

function numberOption(value, name, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number > 2_000_000) {
    throw new Error(`--${name} must be an integer between 0 and 2000000.`);
  }
  return number;
}

export function parseOptions(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      output: { type: 'string', short: 'o' },
      seed: { type: 'boolean', default: false },
      'download-limit': { type: 'string' },
      'upload-limit': { type: 'string' },
      'metadata-timeout': { type: 'string' },
      peer: { type: 'string', multiple: true, default: [] },
    },
  });
  if (values.help) return { help: true };
  if (positionals.length !== 1)
    throw new Error('Provide exactly one magnet link or .torrent file.');
  const source = positionals[0];
  if (source.startsWith('magnet:')) {
    const magnet = new URL(source);
    if (
      !magnet.searchParams
        .getAll('xt')
        .some((xt) => /^urn:btih:([a-f\d]{40}|[a-z2-7]{32})$/i.test(xt))
    ) {
      throw new Error(
        'Magnet link must contain a valid BitTorrent v1 info hash (xt=urn:btih:...).',
      );
    }
  } else if (!source.toLowerCase().endsWith('.torrent')) {
    throw new Error('Expected a magnet link or local .torrent file.');
  }
  for (const peer of values.peer) {
    if (!/^(?:[^\s:]+|\[[a-f\d:]+\]):\d+$/i.test(peer)) {
      throw new Error(`Invalid peer address: ${peer}. Expected host:port.`);
    }
    const port = Number(peer.slice(peer.lastIndexOf(':') + 1));
    if (port < 1 || port > 65535) throw new Error('Peer port must be between 1 and 65535.');
  }
  return {
    source: source.startsWith('magnet:') ? source : resolve(source),
    output: resolve(values.output ?? 'downloads'),
    seed: values.seed,
    peers: values.peer,
    downloadLimit: numberOption(values['download-limit'], 'download-limit', -1),
    uploadLimit: numberOption(values['upload-limit'], 'upload-limit', -1),
    metadataTimeout: numberOption(values['metadata-timeout'], 'metadata-timeout', 120),
  };
}
