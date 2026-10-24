// Análisis estático de qué hoja de estilos de app necesita cada ruta. Lo usa
// tests/unit/css-scope.test.ts: si un componente usa una clase que solo define
// styles/<app>.css, esa hoja tiene que importarse en algún archivo alcanzable
// desde la ruta (la página, sus layouts o los componentes que importan).
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { ROOT } from './i18n-client-scope';

const STYLES = path.join(ROOT, 'styles');
const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];

/** Clases de una hoja (solo selectores, sin comentarios ni declaraciones). */
export function cssClasses(css: string): Set<string> {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[] = [];
  // Texto fuera de las llaves de declaración (las @media anidan una llave más).
  let depth = 0;
  let buf = '';
  for (const ch of noComments) {
    if (ch === '{') {
      selectors.push(buf);
      buf = '';
      depth++;
    } else if (ch === '}') {
      buf = '';
      depth--;
    } else buf += ch;
  }
  const out = new Set<string>();
  for (const s of selectors) {
    if (/^\s*@/.test(s) && !/^\s*@media|^\s*@supports|^\s*@container/.test(s)) continue;
    // Una declaración suelta (prop: valor;) antes de un selector anidado no cuenta.
    const sel = s.includes(';') ? s.slice(s.lastIndexOf(';') + 1) : s;
    for (const m of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  }
  return out;
}

type CodeFile = { imports: string[]; css: string[]; tokens: Set<string> };
const codeCache = new Map<string, CodeFile>();

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTS) if (fs.existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) {
    const idx = path.join(base, 'index' + ext);
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

function codeFile(file: string): CodeFile {
  const hit = codeCache.get(file);
  if (hit) return hit;
  const src = fs.readFileSync(file, 'utf8');
  const pre = ts.preProcessFile(src, true, true);
  const imports: string[] = [];
  const css: string[] = [];
  for (const f of pre.importedFiles) {
    const r = resolve(file, f.fileName);
    if (!r) continue;
    if (r.endsWith('.css')) css.push(r);
    else if (/\.(tsx?|jsx?|mjs)$/.test(r)) imports.push(r);
  }
  // Tokens candidatos a clase: palabras dentro de literales de string y template.
  const tokens = new Set<string>();
  for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    for (const w of m[2].matchAll(/-?[_a-zA-Z][\w-]*/g)) tokens.add(w[0]);
  }
  const info = { imports, css, tokens };
  codeCache.set(file, info);
  return info;
}

/** Archivos de código y hojas importadas alcanzables desde `entries`. */
export function reach(entries: string[]): { files: Set<string>; css: Set<string> } {
  const files = new Set<string>();
  const css = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const info = codeFile(f);
    for (const c of info.css) css.add(c);
    stack.push(...info.imports);
  }
  return { files, css };
}

/**
 * Clase -> hoja de app que la define, solo para clases que define una única
 * hoja (las que comparten varias hojas o las globales no permiten saber cuál
 * hace falta).
 */
export function uniqueClassOwners(appSheets: string[], baseSheets: string[]): Map<string, string> {
  const count = new Map<string, string[]>();
  for (const sheet of [...appSheets, ...baseSheets]) {
    for (const c of cssClasses(fs.readFileSync(sheet, 'utf8'))) count.set(c, [...(count.get(c) ?? []), sheet]);
  }
  const base = new Set(baseSheets);
  const out = new Map<string, string>();
  for (const [c, sheets] of count) {
    const uniq = [...new Set(sheets)];
    if (uniq.length === 1 && !base.has(uniq[0])) out.set(c, uniq[0]);
  }
  return out;
}

export function stylesheet(name: string): string {
  return path.join(STYLES, name);
}
