import * as prompts from '@clack/prompts';
import { resolve } from 'node:path';
import process from 'node:process';
import { numberOption, validateSource } from './options.mjs';

export class InteractiveCancelError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'InteractiveCancelError';
    this.exitCode = 130;
  }
}

function assertNotCancelled(value) {
  if (prompts.isCancel(value)) throw new InteractiveCancelError();
  return value;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

/** Fill missing options via Clack when running on a TTY. */
export async function promptMissingOptions(partial) {
  prompts.intro('torrent-dl');

  let source = partial.source;
  if (!source) {
    const input = assertNotCancelled(
      await prompts.text({
        message: 'Magnet link or path to .torrent file',
        validate(value) {
          try {
            validateSource(value.trim());
            return undefined;
          } catch (error) {
            return error.message;
          }
        },
      }),
    );
    source = validateSource(input.trim());
  }

  let output = partial.output;
  if (!partial.outputExplicit) {
    const input = assertNotCancelled(
      await prompts.text({
        message: 'Download folder',
        initialValue: './downloads',
      }),
    );
    output = resolve(input.trim() || 'downloads');
  }

  let seed = partial.seed;
  if (partial.incomplete || partial.interactive) {
    seed = assertNotCancelled(
      await prompts.confirm({
        message: 'Keep seeding after download completes?',
        initialValue: seed,
      }),
    );
  }

  let downloadLimit = partial.downloadLimit;
  let uploadLimit = partial.uploadLimit;
  if (
    (partial.incomplete || partial.interactive) &&
    !partial.downloadLimitExplicit &&
    !partial.uploadLimitExplicit
  ) {
    const setLimits = assertNotCancelled(
      await prompts.confirm({
        message: 'Set download/upload speed limits?',
        initialValue: false,
      }),
    );
    if (setLimits) {
      const down = assertNotCancelled(
        await prompts.text({
          message: 'Download limit in KiB/s (blank = unlimited)',
          defaultValue: '',
        }),
      );
      const up = assertNotCancelled(
        await prompts.text({
          message: 'Upload limit in KiB/s (blank = unlimited)',
          defaultValue: '',
        }),
      );
      downloadLimit =
        down.trim() === '' ? -1 : numberOption(down.trim(), 'download-limit', -1);
      uploadLimit = up.trim() === '' ? -1 : numberOption(up.trim(), 'upload-limit', -1);
    }
  }

  prompts.outro('Starting download');
  return {
    ...partial,
    source,
    output,
    seed,
    downloadLimit,
    uploadLimit,
    incomplete: false,
  };
}

/** Multiselect torrent files; returns selected paths. */
export async function promptFileSelection(files) {
  const selected = assertNotCancelled(
    await prompts.multiselect({
      message: 'Select files to download',
      options: files.map((file) => ({
        value: file.path,
        label: `${file.path} (${formatBytes(file.length)})`,
      })),
      required: true,
    }),
  );
  return selected;
}

export function canPrompt(stdin = process.stdin, stdout = process.stdout) {
  return Boolean(stdin.isTTY && stdout.isTTY);
}
