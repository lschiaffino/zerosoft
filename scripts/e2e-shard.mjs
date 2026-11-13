#!/usr/bin/env node
/**
 * Reparte los archivos de tests/e2e entre las partes del CI por duración, no por cantidad: así
 * ninguna parte tarda el doble que otra (con --shard de Playwright una tardaba 40 min y otra 18).
 *
 * Uso: node scripts/e2e-shard.mjs <parte> <total>  → imprime los archivos de esa parte.
 * Las duraciones salen de tests/e2e/timings.json ({ "archivo.spec.ts": ms }), que se actualiza con
 * scripts/e2e-timings.mjs a partir de los resultados de una corrida de CI. Un archivo sin dato
 * cuenta como la mediana. Mismo resultado en todas las partes: el orden es determinístico.
 */
import fs from 'node:fs';
import path from 'node:path';

const [part, total] = process.argv.slice(2).map(Number);
if (!part || !total || part > total) {
  console.error('uso: node scripts/e2e-shard.mjs <parte> <total>');
  process.exit(2);
}
const dir = 'tests/e2e';
const files = fs
  .readdirSync(dir, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => f.split(path.sep).join('/'))
  .sort();
let timings = {};
try {
  timings = JSON.parse(fs.readFileSync(path.join(dir, 'timings.json'), 'utf8'));
} catch {
  /* sin tiempos: todos valen lo mismo */
}
const known = files.map((f) => timings[f]).filter((n) => typeof n === 'number').sort((a, b) => a - b);
const median = known.length ? known[Math.floor(known.length / 2)] : 60_000;
const cost = (f) => (typeof timings[f] === 'number' ? timings[f] : median);
// El más largo primero, a la parte que menos lleva (desempate por nombre y número de parte).
const bins = Array.from({ length: total }, () => ({ ms: 0, files: [] }));
for (const f of [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
  let best = 0;
  for (let i = 1; i < total; i++) if (bins[i].ms < bins[best].ms) best = i;
  bins[best].ms += cost(f);
  bins[best].files.push(`${dir}/${f}`);
}
if (process.env.E2E_SHARD_REPORT) {
  bins.forEach((b, i) => console.error(`parte ${i + 1}: ${(b.ms / 60000).toFixed(1)} min, ${b.files.length} archivos`));
}
process.stdout.write(bins[part - 1].files.join(' '));
