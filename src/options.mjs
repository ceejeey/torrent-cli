import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { URL } from 'node:url';

export const help = `Usage: torrent-cli [magnet-link|file.torrent] [options]

Options:
  -o, --output <folder>       Download folder (default: ./downloads)
      --download-limit <n>   Download cap in KiB/s (default: unlimited)
      --upload-limit <n>     Upload cap in KiB/s (default: unlimited)
      --metadata-timeout <n> Seconds to wait for metadata (default: 120; 0 disables)
      --peer <host:port>     Connect to a peer directly (repeatable)
      --seed                 Keep seeding after completion
  -i, --interactive          Prompt for missing options (TTY)
      --no-select-files      Skip interactive multi-file selection
  -h, --help                 Show this help

With no source on a TTY, prompts ask for magnet/file, output, and seed.
Multi-file torrents open a file picker unless --no-select-files is set.
During download (Ink UI): q quit · s toggle seed after complete.
Ctrl+C stops safely and keeps downloaded data. Run the same command to resume.
Files are stored inside a subfolder named with the torrent name and hash prefix.
Torrents upload to peers while downloading; --seed continues after completion.
Quote magnet links so your shell does not interpret their '&' characters.
`;

export function numberOption(value, name, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number > 2_000_000) {
    throw new Error(`--${name} must be an integer between 0 and 2000000.`);
  }
  return number;
}

export function validateSource(source) {
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
    return source;
  }
  if (!source.toLowerCase().endsWith('.torrent')) {
    throw new Error('Expected a magnet link or local .torrent file.');
  }
  return resolve(source);
}

export function validatePeer(peer) {
  if (!/^(?:[^\s:]+|\[[a-f\d:]+\]):\d+$/i.test(peer)) {
    throw new Error(`Invalid peer address: ${peer}. Expected host:port.`);
  }
  const port = Number(peer.slice(peer.lastIndexOf(':') + 1));
  if (port < 1 || port > 65535) throw new Error('Peer port must be between 1 and 65535.');
  return peer;
}

export function parseOptions(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      output: { type: 'string', short: 'o' },
      seed: { type: 'boolean', default: false },
      interactive: { type: 'boolean', short: 'i', default: false },
      'no-select-files': { type: 'boolean', default: false },
      'download-limit': { type: 'string' },
      'upload-limit': { type: 'string' },
      'metadata-timeout': { type: 'string' },
      peer: { type: 'string', multiple: true, default: [] },
    },
  });
  if (values.help) return { help: true };
  if (positionals.length > 1) {
    throw new Error('Provide exactly one magnet link or .torrent file.');
  }
  for (const peer of values.peer) validatePeer(peer);

  const outputExplicit = values.output !== undefined;
  const downloadLimitExplicit = values['download-limit'] !== undefined;
  const uploadLimitExplicit = values['upload-limit'] !== undefined;
  const base = {
    help: false,
    output: resolve(values.output ?? 'downloads'),
    outputExplicit,
    seed: values.seed,
    interactive: values.interactive,
    selectFiles: !values['no-select-files'],
    peers: values.peer,
    downloadLimit: numberOption(values['download-limit'], 'download-limit', -1),
    downloadLimitExplicit,
    uploadLimit: numberOption(values['upload-limit'], 'upload-limit', -1),
    uploadLimitExplicit,
    metadataTimeout: numberOption(values['metadata-timeout'], 'metadata-timeout', 120),
  };

  if (positionals.length === 0) {
    return { ...base, source: null, incomplete: true };
  }

  return {
    ...base,
    source: validateSource(positionals[0]),
    incomplete: false,
  };
}
