#!/usr/bin/env node
import { main } from '../src/main.mjs';
import { stripTerminal } from '../src/output.mjs';

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${stripTerminal(err?.message ?? err)}\n`);
  process.exitCode = typeof err?.exitCode === 'number' ? err.exitCode : 1;
});
