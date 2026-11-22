#!/usr/bin/env node
/**
 * Qué corre el CI de un pull request según los archivos que toca: qué specs de tests/e2e, en cuántas
 * partes, y si hacen falta el build, e2e-real, la cuarentena y la imagen de Docker.
 *
 * El mapa de áreas está en scripts/e2e-areas.json. Reglas, archivo por archivo:
 *   1. 'skip' (contenido, documentación, escritorio, tests unitarios): no pide e2e.
 *   2. 'core-only' (una migración nueva): solo el grupo 'core'. 'full' (código compartido): suite completa.
 *   3. un spec de tests/e2e: corre ese spec.
 *   4. un área (components/<app>, lib/<app>*, rutas, styles/<app>*.css, messages/<locale>/<app>.json):
 *      corren los specs del área y los de sus áreas 'with' (un solo nivel).
 *   5. cualquier otra cosa: suite completa. Ante la duda, todo.
 * Si corre algo, se suma siempre el grupo 'core'. Fuera de un pull request (main, corrida nocturna, a
 * mano) corre todo.
 *
 * Aparte, `mac`: si el PR toca la app de Mac en Swift (lista 'mac'), corre su job en macOS y "CI result"
 * lo espera. Fuera de un PR no (desktop-mac.yml corre solo con cada push a main que la toca); sin la
 * lista de archivos del PR, sí.
 *
 * Uso en CI: node scripts/e2e-select.mjs --event <evento> [--files <lista, un archivo por línea>]
 * Imprime clave=valor para $GITHUB_OUTPUT y un resumen por stderr.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FULL_SHARDS = 6;
// Minutos de tests por parte en una selección: una parte más cada 25 min (el grupo core solo lleva unos 20),
// hasta las 6 de la suite completa.
const SHARD_MS = 25 * 60_000;
// La API de GitHub lista hasta 3000 archivos por PR: con esa cantidad no se confía en la lista.
const MAX_FILES = 3000;

const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
/** Glob mínimo: `**` cruza carpetas, `*` no. Los corchetes son literales (app/[locale]/…). */
export function globToRegExp(glob) {
  const body = glob
    .split('**/')
    .map((part) => part.split('**').map((p) => p.split('*').map(escape).join('[^/]*')).join('.*'))
    .join('(?:.*/)?');
  return new RegExp(`^${body}$`);
}
const matcher = (globs) => {
  const res = (globs ?? []).map(globToRegExp);
  return (file) => res.some((re) => re.test(file));
};

/** Los lugares donde vive una app llamada `n` (AGENTS.md, "Where things are"). */
export const namePaths = (n) => [
  `components/${n}/**`,
  `app/[locale]/app/${n}/**`,
  `app/api/${n}/**`,
  `lib/routes/${n}/**`,
  `lib/${n}/**`,
  `lib/${n}.ts`,
  `lib/${n}.tsx`,
  `lib/${n}-*`,
  `styles/${n}.css`,
  `styles/${n}-*.css`,
  `messages/*/${n}.json`,
];

const specName = (file) => path.posix.basename(file).replace(/\.spec\.ts$/, '');

export function compileAreas(config) {
  const areas = Object.entries(config.areas).map(([name, a]) => ({
    name,
    with: a.with ?? [],
    matchesPath: matcher([...(a.names ?? []).flatMap(namePaths), ...(a.paths ?? [])]),
    matchesSpec: matcher(a.specs),
  }));
  return {
    areas,
    skip: matcher(config.skip),
    full: matcher(config.full),
    coreOnly: matcher(config['core-only']),
    core: matcher(config.core),
    fullOnly: matcher(config['full-only']),
    docker: matcher(config.docker),
    real: matcher(config.real),
    quarantine: matcher(config.quarantine),
    mac: matcher(config.mac),
  };
}

/** Las áreas a las que pertenece un spec (por nombre de archivo). Vacío: solo corre en la suite completa o en 'core'. */
export function areasOfSpec(compiled, spec) {
  const name = specName(spec);
  return compiled.areas.filter((a) => a.matchesSpec(name)).map((a) => a.name);
}

/**
 * @param {string[]} changed archivos del pull request (rutas desde la raíz del repo)
 * @param {{ event?: string, specs: string[], timings?: Record<string, number>, config: object, quarantined?: string[] }} ctx
 *   specs: los *.spec.ts de tests/e2e (relativos a tests/e2e); quarantined: specs con tests en cuarentena.
 */
export function selectE2e(changed, { event = 'pull_request', specs, timings = {}, config, quarantined = [] }) {
  const c = compileAreas(config);
  const all = [...specs].sort();
  const everything = (reason, mac) => ({
    mode: 'full', reason, specs: all, shards: FULL_SHARDS, areas: [], build: true, real: true, quarantine: true, docker: true, mac,
  });
  if (event !== 'pull_request') return everything(`evento ${event}: corre todo`, false);
  const files = [...new Set(changed.map((f) => f.trim()).filter(Boolean))];
  if (!files.length) return everything('no se pudo leer la lista de archivos del pull request', true);
  if (files.length >= MAX_FILES) return everything('demasiados archivos para confiar en la lista', true);

  const mac = files.some(c.mac);
  const docker = files.some(c.docker);
  const real = files.some(c.real);
  const quarantine = files.some((f) => c.quarantine(f) || quarantined.some((q) => f === `tests/e2e/${q}`));

  let fullReason = null;
  let coreOnly = false;
  const areaNames = new Set();
  const picked = new Set();
  for (const f of files) {
    if (c.skip(f)) continue;
    if (c.coreOnly(f)) {
      coreOnly = true;
      continue;
    }
    if (c.full(f)) {
      fullReason ??= `${f} es código compartido`;
      continue;
    }
    const spec = f.match(/^tests\/e2e\/(.+\.spec\.ts)$/)?.[1];
    if (spec) {
      // Un spec borrado ya no está en la lista: no hay nada que correr por él.
      if (all.includes(spec)) picked.add(spec);
      continue;
    }
    const hits = c.areas.filter((a) => a.matchesPath(f));
    if (!hits.length) {
      fullReason ??= `${f} no pertenece a ningún área`;
      continue;
    }
    for (const a of hits) areaNames.add(a.name);
  }

  const flags = { real, quarantine, docker, mac };
  if (fullReason) return { mode: 'full', reason: fullReason, specs: all, shards: FULL_SHARDS, areas: [], build: true, ...flags };

  // Las áreas tocadas y, un solo nivel, las que dependen de ellas.
  const run = new Set(areaNames);
  for (const a of c.areas) if (areaNames.has(a.name)) for (const w of a.with) run.add(w);
  for (const s of all) if (areasOfSpec(c, s).some((a) => run.has(a))) picked.add(s);

  if (!picked.size && !areaNames.size && !coreOnly) {
    return {
      mode: 'none', reason: 'solo contenido, documentación o archivos sin e2e', specs: [], shards: 0, areas: [],
      build: real || quarantine, ...flags,
    };
  }
  const reason = areaNames.size ? `áreas: ${[...areaNames].sort().join(', ')}` : picked.size ? 'solo specs de e2e' : 'solo el grupo core';
  for (const s of all) if (c.core(specName(s))) picked.add(s);
  const selected = all.filter((s) => picked.has(s));
  if (selected.length === all.length) {
    return { mode: 'full', reason: 'la selección cubre toda la suite', specs: all, shards: FULL_SHARDS, areas: [...run].sort(), build: true, ...flags };
  }
  return {
    mode: 'selected',
    reason,
    specs: selected,
    shards: shardCount(selected, all, timings),
    areas: [...run].sort(),
    build: true,
    ...flags,
  };
}

/** Partes para una selección: por minutos de tests (un spec sin dato vale la mediana), nunca más partes que specs. */
export function shardCount(selected, all, timings) {
  const known = all.map((f) => timings[f]).filter((n) => typeof n === 'number').sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 60_000;
  const ms = selected.reduce((sum, f) => sum + (typeof timings[f] === 'number' ? timings[f] : median), 0);
  return Math.max(1, Math.min(FULL_SHARDS, selected.length, Math.ceil(ms / SHARD_MS)));
}

/** Specs con algún test en cuarentena (tests/e2e/quarantine.json: "archivo.spec.ts › título"). */
export function quarantinedSpecs(entries) {
  return [...new Set((entries ?? []).map((e) => String(e.test ?? '').split(' › ')[0]).filter((f) => f.endsWith('.spec.ts')))];
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    return fallback;
  }
};
export const loadConfig = () => JSON.parse(fs.readFileSync(path.join(root, 'scripts/e2e-areas.json'), 'utf8'));
export const listSpecs = () =>
  fs
    .readdirSync(path.join(root, 'tests/e2e'), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => f.split(path.sep).join('/'))
    .sort();

/** La decisión con los archivos reales del repo. */
export function plan(changed, event = 'pull_request') {
  return selectE2e(changed, {
    event,
    specs: listSpecs(),
    timings: readJson('tests/e2e/timings.json', {}),
    config: loadConfig(),
    quarantined: quarantinedSpecs(readJson('tests/e2e/quarantine.json', [])),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const event = arg('--event') ?? 'pull_request';
  let changed = [];
  const list = arg('--files');
  // Sin lista legible queda vacía, y una lista vacía en un pull request pide la suite completa.
  if (list) {
    try {
      changed = fs.readFileSync(list, 'utf8').split('\n');
    } catch {
      changed = [];
    }
  }
  const p = plan(changed, event);
  const e2e = p.mode !== 'none';
  const out = {
    mode: p.mode,
    e2e,
    build: p.build,
    real: p.real,
    quarantine: p.quarantine,
    docker: p.docker,
    mac: p.mac,
    shard_total: p.shards || 1,
    // Siempre un JSON válido: la matriz se evalúa aunque el job quede salteado.
    shards: JSON.stringify(Array.from({ length: p.shards || 1 }, (_, i) => i + 1)),
    // Vacío en la suite completa: scripts/e2e-shard.mjs reparte entonces todos los specs.
    specs: p.mode === 'selected' ? p.specs.join(' ') : '',
  };
  process.stdout.write(Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''));
  const summary = [
    `e2e: ${p.mode} (${p.reason})`,
    e2e ? `specs: ${p.specs.length} en ${p.shards} parte(s)` : 'specs: ninguno',
    `build=${p.build} e2e-real=${p.real} cuarentena=${p.quarantine} docker=${p.docker} mac=${p.mac}`,
  ].join('\n');
  console.error(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Plan de CI\n\n\`\`\`\n${summary}\n\`\`\`\n`);
}
