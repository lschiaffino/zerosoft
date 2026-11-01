#!/usr/bin/env node
import { main } from '../src/main.mjs';

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${err?.message ?? err}\n`);
  process.exitCode = typeof err?.exitCode === 'number' ? err.exitCode : 1;
});
