#!/usr/bin/env node
/**
 * Reparte los archivos de tests/e2e entre las partes del CI por duración, no por cantidad: así
 * ninguna parte tarda el doble que otra (con --shard de Playwright una tardaba 40 min y otra 18).
 *
 * Uso: node scripts/e2e-shard.mjs <parte> <total> [specs…]  → imprime los archivos de esa parte.
 * Con una lista de specs (argumentos o la variable E2E_SPECS, separados por espacios; nombres relativos
 * a tests/e2e) reparte solo esos: es la selección por área de un pull request (scripts/e2e-select.mjs).
 * Sin lista reparte todos. Un nombre que no existe en tests/e2e se ignora.
 * Las duraciones salen de tests/e2e/timings.json ({ "archivo.spec.ts": ms }), que se actualiza con
 * scripts/e2e-timings.mjs a partir de los resultados de una corrida de CI. Un archivo sin dato
 * cuenta como la mediana. Mismo resultado en todas las partes: el orden es determinístico.
 */
import fs from 'node:fs';
import path from 'node:path';

const [part, total] = process.argv.slice(2, 4).map(Number);
if (!part || !total || part > total) {
  console.error('uso: node scripts/e2e-shard.mjs <parte> <total> [specs…]');
  process.exit(2);
}
const wanted = [...process.argv.slice(4), ...(process.env.E2E_SPECS ?? '').split(/\s+/)]
  .filter(Boolean)
  .map((f) => f.replace(/^tests\/e2e\//, ''));
const dir = 'tests/e2e';
const every = fs
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
const files = wanted.length ? every.filter((f) => wanted.includes(f)) : every;
if (wanted.length && !files.length) {
  // Sin esto la parte saldría vacía y `playwright test` sin argumentos correría toda la suite.
  console.error('e2e-shard: ninguno de los specs pedidos existe en tests/e2e');
  process.exit(2);
}
// La mediana sale de toda la suite, no de la selección.
const known = every.map((f) => timings[f]).filter((n) => typeof n === 'number').sort((a, b) => a - b);
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
