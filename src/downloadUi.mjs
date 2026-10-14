import { createElement } from 'react';
import { Box, Text, render, useInput } from 'ink';
import process from 'node:process';
import { safeText } from './progress.mjs';

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function progressBar(progress, width = 24) {
  const ratio = Math.min(1, Math.max(0, progress || 0));
  const filled = Math.round(ratio * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}

function DownloadPanel({ status }) {
  const { name, destination, torrent, seed, message, done } = status;
  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) status.onQuit?.();
    if (input === 's') status.onToggleSeed?.();
  });

  const progress = torrent?.progress ?? 0;
  const eta =
    torrent && torrent.downloadSpeed > 0
      ? `${Math.ceil((torrent.length - torrent.downloaded) / torrent.downloadSpeed)}s`
      : 'waiting';

  return createElement(
    Box,
    { flexDirection: 'column', paddingX: 1 },
    createElement(Text, { bold: true }, safeText(name || 'Fetching metadata...')),
    destination
      ? createElement(Text, { dimColor: true }, safeText(`→ ${destination}`))
      : null,
    message ? createElement(Text, null, safeText(message)) : null,
    torrent
      ? createElement(
          Box,
          { flexDirection: 'column', marginTop: 1 },
          createElement(
            Text,
            null,
            `${progressBar(progress)} ${(progress * 100).toFixed(1)}%  ${formatBytes(torrent.downloaded)}/${formatBytes(torrent.length)}`,
          ),
          createElement(
            Text,
            null,
            `down ${formatBytes(torrent.downloadSpeed)}/s · up ${formatBytes(torrent.uploadSpeed)}/s · ${torrent.numPeers} peers · ETA ${eta}`,
          ),
        )
      : null,
    createElement(
      Text,
      { dimColor: true, marginTop: 1 },
      done
        ? `Seeding · q quit · s seed: ${seed ? 'on' : 'off'}`
        : `q quit · s seed after done: ${seed ? 'on' : 'off'}`,
    ),
  );
}

/**
 * Ink-based reporter matching createReporter()'s shape, plus pause/resume for Clack.
 */
export function createInkReporter({
  seedRef,
  onQuit,
  stdout = process.stdout,
  stdin = process.stdin,
} = {}) {
  const status = {
    name: '',
    destination: '',
    torrent: null,
    seed: Boolean(seedRef?.seed),
    message: 'Finding peers and fetching metadata...',
    done: false,
    onQuit,
    onToggleSeed() {
      if (!seedRef) return;
      seedRef.seed = !seedRef.seed;
      status.seed = seedRef.seed;
      redraw();
    },
  };

  let instance = null;

  function mount() {
    if (instance) return;
    instance = render(createElement(DownloadPanel, { status }), { stdout, stdin });
  }

  function redraw() {
    if (!instance) return;
    instance.rerender(createElement(DownloadPanel, { status }));
  }

  mount();

  return {
    log(message) {
      status.message = message;
      if (message.startsWith('Downloading:')) {
        status.name = message.slice('Downloading:'.length).trim();
      }
      if (message.startsWith('Destination:')) {
        status.destination = message.slice('Destination:'.length).trim();
      }
      if (message.startsWith('Download complete. Seeding')) {
        status.done = true;
      }
      redraw();
    },
    progress(torrent) {
      status.torrent = {
        progress: torrent.progress,
        downloaded: torrent.downloaded,
        length: torrent.length,
        downloadSpeed: torrent.downloadSpeed,
        uploadSpeed: torrent.uploadSpeed,
        numPeers: torrent.numPeers,
      };
      status.seed = Boolean(seedRef?.seed);
      status.message = '';
      redraw();
    },
    clear() {},
    interval: 500,
    async pause() {
      if (!instance) return;
      instance.unmount();
      instance = null;
    },
    resume() {
      mount();
      redraw();
    },
    async dispose() {
      if (!instance) return;
      instance.unmount();
      instance = null;
    },
  };
}
