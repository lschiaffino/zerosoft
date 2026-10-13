/**
 * Robots — prueba local del script que corre dentro de Vercel Sandbox: lo
 * genera (intérprete serializado), lo ejecuta con node y playwright-core
 * locales contra example.com e imprime el resultado.
 *
 *   npx tsx scripts/robots-script-check.ts [url]
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { buildRunnerScript } from '../lib/robots-sandbox';

const url = process.argv[2] ?? 'https://example.com';
const dir = mkdtempSync(path.join(tmpdir(), 'robot-'));
const script = buildRunnerScript().replace("require('playwright-core')", `require(${JSON.stringify(require.resolve('playwright-core'))})`);
writeFileSync(path.join(dir, 'runner.cjs'), script);
writeFileSync(
  path.join(dir, 'job.json'),
  JSON.stringify({
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'extract', selector: 'h1, p', name: 'heading', mode: 'text', attribute: '' },
      { type: 'extract', selector: 'script', name: 'script', mode: 'attribute', attribute: 'src' },
      { type: 'screenshot', name: 'page' },
    ],
    inputs: { url },
    robotName: 'check',
    timeoutMs: 60_000,
    maxPages: 20,
    maxScreenshots: 5,
    maxExecuted: 500,
    maxLoopItems: 50,
  }),
);
execFileSync('node', [path.join(dir, 'runner.cjs'), path.join(dir, 'job.json'), path.join(dir, 'result.json')], {
  stdio: 'inherit',
});
const result = JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8'));
// eslint-disable-next-line no-console
console.log(JSON.stringify({ ...result, screenshots: result.screenshots.map((s: { name: string; data: string }) => ({ name: s.name, bytes: s.data.length })) }, null, 2));
