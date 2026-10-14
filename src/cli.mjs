#!/usr/bin/env node
import process from 'node:process';
import { parseOptions, help } from './options.mjs';
import { download } from './download.mjs';
import { createReporter, safeText } from './progress.mjs';
import {
  canPrompt,
  InteractiveCancelError,
  promptFileSelection,
  promptMissingOptions,
} from './interactive.mjs';
import { createInkReporter } from './downloadUi.mjs';

const controller = new globalThis.AbortController();
const stop = () => controller.abort();

try {
  let options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help);
  } else {
    const interactive =
      canPrompt() && (options.incomplete || options.interactive || options.selectFiles);

    if (canPrompt() && (options.incomplete || options.interactive)) {
      options = await promptMissingOptions(options);
    } else if (options.incomplete) {
      throw new Error('Provide exactly one magnet link or .torrent file.');
    }

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    const seedRef = { seed: options.seed };
    const useInk = canPrompt();
    const reporter = useInk
      ? createInkReporter({ seedRef, onQuit: stop })
      : createReporter();

    const selectFiles =
      interactive && options.selectFiles
        ? async (torrent) => promptFileSelection(torrent.files)
        : undefined;

    process.exitCode = await download(options, {
      signal: controller.signal,
      reporter,
      seedRef,
      selectFiles,
    });
  }
} catch (error) {
  if (error instanceof InteractiveCancelError) {
    process.exitCode = 130;
  } else {
    process.stderr.write(`Error: ${safeText(error.message)}\nRun with --help for usage.\n`);
    process.exitCode = error.exitCode ?? 1;
  }
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
