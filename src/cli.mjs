#!/usr/bin/env node
import process from 'node:process';
import { parseOptions, help } from './options.mjs';
import { download } from './download.mjs';
import { safeText } from './progress.mjs';

const controller = new globalThis.AbortController();
const stop = () => controller.abort();
try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help);
  } else {
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    process.exitCode = await download(options, { signal: controller.signal });
  }
} catch (error) {
  process.stderr.write(`Error: ${safeText(error.message)}\nRun with --help for usage.\n`);
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
