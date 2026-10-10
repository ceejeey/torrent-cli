import { stripVTControlCharacters } from 'node:util';
import process from 'node:process';

export function safeText(value) {
  return stripVTControlCharacters(String(value)).replace(/[\r\n\t]/g, ' ');
}

function bytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function createReporter(output = process.stderr) {
  let active = false;
  function clear() {
    if (active && output.isTTY) output.write('\r\x1b[2K');
    active = false;
  }
  return {
    log(message) {
      clear();
      output.write(`${safeText(message)}\n`);
    },
    progress(torrent) {
      const eta =
        torrent.downloadSpeed > 0
          ? `${Math.ceil((torrent.length - torrent.downloaded) / torrent.downloadSpeed)}s`
          : 'waiting';
      const line = `${(torrent.progress * 100).toFixed(1)}% | ${bytes(torrent.downloaded)}/${bytes(torrent.length)} | down ${bytes(torrent.downloadSpeed)}/s | up ${bytes(torrent.uploadSpeed)}/s | ${torrent.numPeers} peers | ETA ${eta}`;
      clear();
      output.write(
        output.isTTY ? line.slice(0, Math.max(1, (output.columns || 120) - 1)) : `${line}\n`,
      );
      active = Boolean(output.isTTY);
    },
    clear,
    interval: output.isTTY ? 1000 : 10000,
  };
}
