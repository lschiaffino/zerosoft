#!/usr/bin/env node
/**
 * Actualiza tests/e2e/timings.json con la duración de cada archivo de tests e2e, sumando los
 * resultados JSON de Playwright de una corrida de CI (artifact e2e-results-*; reporter json en
 * playwright.config.ts). Uso: node scripts/e2e-timings.mjs <carpeta con results-*.json>
 */
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('uso: node scripts/e2e-timings.mjs <carpeta>');
  process.exit(2);
}
const out = path.join('tests/e2e', 'timings.json');
let timings = {};
try {
  timings = JSON.parse(fs.readFileSync(out, 'utf8'));
} catch {
  /* primera vez */
}
const fresh = {};
function walk(suite, file) {
  const f = suite.file || file;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      // El último intento (si hubo reintento, el que pasó).
      const r = (t.results ?? []).at(-1);
      if (r && f) fresh[f] = (fresh[f] ?? 0) + (r.duration ?? 0);
    }
  }
  for (const s of suite.suites ?? []) walk(s, f);
}
for (const name of fs.readdirSync(src, { recursive: true }).map(String).filter((n) => n.endsWith('.json'))) {
  const data = JSON.parse(fs.readFileSync(path.join(src, name), 'utf8'));
  for (const s of data.suites ?? []) walk(s, s.file);
}
// Los archivos de la corrida reemplazan su dato; los que no corrieron conservan el anterior.
const merged = Object.fromEntries(Object.entries({ ...timings, ...fresh }).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`${Object.keys(fresh).length} archivos con tiempo nuevo; ${Object.keys(merged).length} en total`);
