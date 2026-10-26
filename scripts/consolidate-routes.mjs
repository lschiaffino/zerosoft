#!/usr/bin/env node
/**
 * Consolida las rutas API dinámicas de una familia en un único catch-all.
 *
 * Por qué: Vercel acepta como máximo 2048 rutas en `.vercel/output/config.json`
 * y cada route handler con segmentos dinámicos (`[id]`) suma entradas propias;
 * las rutas estáticas no suman. Ver docs/routes-budget.md.
 *
 * Uso:
 *   node scripts/consolidate-routes.mjs app/api/crm [app/api/track ...] [--dry]
 *   node scripts/consolidate-routes.mjs --count   # cuenta rutas dinámicas sueltas por familia
 *
 * Qué hace con cada base (p. ej. `app/api/crm`, o una base dinámica como
 * `app/api/agents/[id]`):
 * 1. Toma cada `route.ts(x)` debajo de la base cuya URL tenga un segmento
 *    dinámico, salvo las que tienen config de segmento propia
 *    (`maxDuration`, `dynamic` distinto de `force-dynamic`, `runtime` distinto
 *    de `nodejs`, `revalidate`, `generateStaticParams`, ...): esas quedan como
 *    archivo y Next las prefiere antes que el catch-all. Si una de ellas cuelga
 *    de un segmento dinámico del primer nivel (chocaría con el catch-all), el
 *    script corta y hay que elegir una base más profunda.
 * 2. La mueve sin tocarla (`git mv`) a `lib/routes/<misma ruta>/route.ts`
 *    (solo reescribe imports relativos a alias `@/`).
 * 3. Reescribe en todo el repo los imports a esos módulos.
 * 4. (Re)genera `<base>/[...zsPath]/route.ts`, que despacha con
 *    `lib/routes/dispatch.ts`. Es idempotente: si el catch-all ya existe, suma
 *    las rutas nuevas a las que ya tenía.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const PARAM = 'zsPath';
const CATCH_ALL = `[...${PARAM}]`;
const GENERATED_MARK = '// Generado por scripts/consolidate-routes.mjs';
const SCAN_DIRS = ['app', 'lib', 'components', 'tests', 'ee', 'scripts', 'i18n', 'content'];
const ROUTE_FILE = /^route\.tsx?$/;

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const bases = args.filter((a) => !a.startsWith('--'));

const toPosix = (p) => p.split('\\').join('/');
const rel = (abs) => toPosix(relative(ROOT, abs));

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function routeFiles(dir) {
  return walk(dir).filter((f) => ROUTE_FILE.test(f.split('/').pop()));
}

/** Config de segmento que el catch-all no puede heredar sin cambiar comportamiento. */
function customConfig(src) {
  const found = [];
  const m = (re) => re.exec(src);
  if (m(/export\s+const\s+maxDuration\b/)) found.push('maxDuration');
  const dyn = m(/export\s+const\s+dynamic\s*=\s*['"]([^'"]+)['"]/);
  if (dyn && dyn[1] !== 'force-dynamic') found.push(`dynamic=${dyn[1]}`);
  const rt = m(/export\s+const\s+runtime\s*=\s*['"]([^'"]+)['"]/);
  if (rt && rt[1] !== 'nodejs') found.push(`runtime=${rt[1]}`);
  for (const k of ['revalidate', 'dynamicParams', 'fetchCache', 'preferredRegion', 'generateStaticParams', 'config']) {
    if (new RegExp(`export\\s+(const|async function|function)\\s+${k}\\b`).test(src)) found.push(k);
  }
  return found;
}

const isDynamic = (seg) => seg.startsWith('[');

if (args.includes('--count')) {
  const files = routeFiles(join(ROOT, 'app/api'));
  const counts = {};
  for (const f of files) {
    const r = rel(f).replace(/^app\/api\//, '');
    if (!r.includes('[') || r.includes(CATCH_ALL)) continue;
    const fam = r.split('/')[0] === 'v1' ? r.split('/').slice(0, 2).join('/') : r.split('/')[0];
    counts[fam] = (counts[fam] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [fam, n] of sorted) console.log(String(n).padStart(4), fam);
  console.log(String(sorted.reduce((s, [, n]) => s + n, 0)).padStart(4), 'total rutas API dinámicas sueltas');
  process.exit(0);
}

if (bases.length === 0) {
  console.error('uso: node scripts/consolidate-routes.mjs app/api/<familia> [...] [--dry] | --count');
  process.exit(1);
}

/** original (repo-relative, sin extensión) -> nuevo (repo-relative, sin extensión) */
const moved = new Map();
const plans = [];

for (const baseArg of bases) {
  const base = toPosix(baseArg).replace(/\/$/, '');
  if (!base.startsWith('app/api/')) throw new Error(`${base}: la base tiene que estar en app/api/`);
  const baseAbs = join(ROOT, base);
  const catchAllFile = join(baseAbs, CATCH_ALL, 'route.ts');
  const existing = [];
  if (existsSync(catchAllFile)) {
    const src = readFileSync(catchAllFile, 'utf8');
    if (!src.includes(GENERATED_MARK)) throw new Error(`${rel(catchAllFile)} existe y no es generado`);
    for (const m of src.matchAll(/pattern: '([^']+)', mod: \w+ \}, \/\/ (\S+)/g)) existing.push({ pattern: m[1], target: m[2] });
  }
  const take = [];
  const keep = [];
  const blockers = [];
  for (const file of routeFiles(baseAbs)) {
    const r = rel(file);
    const relPath = toPosix(relative(baseAbs, dirname(file)));
    if (relPath === '' || relPath.split('/')[0] === CATCH_ALL) continue;
    if (!r.includes('[')) continue; // estática: no suma rutas en Vercel
    const cfg = customConfig(readFileSync(file, 'utf8'));
    if (cfg.length) {
      if (isDynamic(relPath.split('/')[0])) blockers.push(`${r} (${cfg.join(', ')})`);
      else keep.push(`${r} (${cfg.join(', ')})`);
      continue;
    }
    take.push({ file, relPath });
  }
  if (blockers.length) {
    console.error(
      `${base}: estas rutas tienen config propia y cuelgan de un segmento dinámico del primer nivel; ` +
        `elegí una base más profunda (p. ej. ${base}/[id]) o dejá la familia como está:\n  ${blockers.join('\n  ')}`,
    );
    process.exit(1);
  }
  for (const { file } of take) {
    const from = rel(file);
    const to = from.replace(/^app\/api\//, 'lib/routes/');
    moved.set(from.replace(/\.tsx?$/, ''), to.replace(/\.tsx?$/, ''));
  }
  plans.push({ base, catchAllFile, existing, take, keep });
}

const repoFiles = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
const exts = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/** Resuelve un especificador a ruta repo-relativa sin extensión, o null si no es un archivo del repo. */
function resolveSpec(spec, fromDirRel) {
  let base;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('./') || spec.startsWith('../')) base = posix.normalize(posix.join(fromDirRel, spec));
  else return null;
  for (const e of exts) {
    if (existsSync(join(ROOT, base + e)) && statSync(join(ROOT, base + e)).isFile()) {
      return (base + e).replace(/\.(tsx?|mjs|js)$/, '').replace(/\/index$/, e.startsWith('/index') ? '/index' : '');
    }
  }
  return null;
}

const SPEC = /(['"])((?:@\/|\.\.?\/)[^'"\n]+)\1/g;
const rewrites = [];
for (const file of repoFiles) {
  const fileRel = rel(file);
  const origKey = fileRel.replace(/\.tsx?$/, '');
  const isMoved = moved.has(origKey);
  const src = readFileSync(file, 'utf8');
  const out = src.replace(SPEC, (all, q, spec) => {
    const target = resolveSpec(spec, posix.dirname(fileRel));
    if (!target) return all;
    if (moved.has(target)) return `${q}@/${moved.get(target)}${q}`;
    if (isMoved && !spec.startsWith('@/')) return `${q}@/${target}${q}`;
    return all;
  });
  if (out !== src) rewrites.push({ file, out });
}

function header() {
  return [
    GENERATED_MARK + ': no editar a mano.',
    '// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de',
    '// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).',
  ].join('\n');
}

function generate(plan) {
  const entries = new Map();
  for (const e of plan.existing) entries.set(e.pattern, e.target);
  for (const { relPath, file } of plan.take) {
    entries.set(relPath, rel(file).replace(/^app\/api\//, 'lib/routes/').replace(/\/route\.tsx?$/, ''));
  }
  const list = [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const lines = [header(), "import { createDispatcher } from '@/lib/routes/dispatch';"];
  list.forEach(([, target], i) => lines.push(`import * as m${i} from '@/${target}/route';`));
  lines.push(
    '',
    "export const runtime = 'nodejs';",
    "export const dynamic = 'force-dynamic';",
    '',
    `const d = createDispatcher('${PARAM}', [`,
    ...list.map(([pattern, target], i) => `  { pattern: '${pattern}', mod: m${i} }, // ${target}`),
    ']);',
    '',
    'export const GET = d.GET;',
    'export const HEAD = d.HEAD;',
    'export const OPTIONS = d.OPTIONS;',
    'export const POST = d.POST;',
    'export const PUT = d.PUT;',
    'export const DELETE = d.DELETE;',
    'export const PATCH = d.PATCH;',
    '',
  );
  return { text: lines.join('\n'), count: list.length };
}

for (const plan of plans) {
  const { text, count } = generate(plan);
  console.log(`${plan.base}: ${plan.take.length} rutas nuevas al catch-all (${count} en total)`);
  for (const k of plan.keep) console.log(`  queda suelta por config: ${k}`);
  plan.text = text;
}
console.log(`${rewrites.length} archivos con imports reescritos`);
if (dry) process.exit(0);

for (const [from, to] of moved) {
  const ext = existsSync(join(ROOT, `${from}.tsx`)) ? '.tsx' : '.ts';
  mkdirSync(dirname(join(ROOT, to + ext)), { recursive: true });
  execFileSync('git', ['mv', from + ext, to + ext], { cwd: ROOT });
}
for (const { file, out } of rewrites) {
  const fileRel = rel(file).replace(/\.tsx?$/, '');
  const dest = moved.has(fileRel) ? join(ROOT, moved.get(fileRel) + file.match(/\.tsx?$/)[0]) : file;
  writeFileSync(dest, out);
}
for (const plan of plans) {
  mkdirSync(dirname(plan.catchAllFile), { recursive: true });
  writeFileSync(plan.catchAllFile, plan.text);
}
