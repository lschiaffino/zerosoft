// Análisis estático de qué namespaces i18n usa cada árbol de componentes
// cliente. Lo usa tests/unit/i18n-client-namespaces.test.ts para comprobar que
// cada ruta le manda al cliente (vía <ClientMessages namespaces={[...]}>) todos
// los namespaces que leen sus componentes con useTranslations.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export const ROOT = path.resolve(__dirname, '..', '..');
const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];

export type FileInfo = {
  file: string;
  client: boolean;
  imports: string[];
  /** Namespaces de primer nivel leídos con useTranslations; '*' = sin namespace. */
  namespaces: string[];
  /** Namespaces que este archivo provee con <ClientMessages namespaces={[...]}>. */
  provides: string[] | null;
};

const cache = new Map<string, FileInfo>();

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return /\.(tsx?|jsx?|mjs)$/.test(base) ? base : null;
  for (const ext of EXTS) if (fs.existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) {
    const idx = path.join(base, 'index' + ext);
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

function isClientSource(src: string): boolean {
  // La directiva tiene que ser la primera sentencia (puede haber comentarios antes).
  const stripped = src.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
  return /^['"]use client['"]/.test(stripped);
}

/** Componentes que leen useMessages() para armar un ámbito, no para traducir. */
const SCOPE_PROVIDERS = ['components/i18n/MessagesScope.tsx'];

/** ¿La ocurrencia en `at` está dentro de un array de dependencias de un hook (`[...])`)? */
function inDepsArray(src: string, at: number): boolean {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const ch = src[i];
    if (ch === ')' || ch === ']' || ch === '}') depth++;
    else if (ch === '(' || ch === '{') {
      if (depth === 0) return false;
      depth--;
    } else if (ch === '[') {
      if (depth > 0) {
        depth--;
        continue;
      }
      // Buscar el ']' que lo cierra y ver que lo siga un ')'.
      let d = 0;
      for (let j = i + 1; j < src.length; j++) {
        if (src[j] === '[') d++;
        else if (src[j] === ']') {
          if (d === 0) return /^\s*\)/.test(src.slice(j + 1));
          d--;
        }
      }
      return false;
    }
  }
  return false;
}

/**
 * Qué partes de `ns` lee la función `name` (const name = useTranslations(ns)):
 * `ns.<primer segmento de la clave>` por cada llamada con clave literal. Si se
 * usa de otra forma (se pasa como prop, clave calculada), se asume todo `ns`.
 */
function keyPrefixes(src: string, name: string, ns: string): string[] {
  const out = new Set<string>();
  const esc = name.replace(/\$/g, '\\$');
  const re = new RegExp(`(?<![\\w$.])${esc}(?![\\w$])`, 'g');
  for (const m of src.matchAll(re)) {
    const at = m.index!;
    const before = src.slice(Math.max(0, at - 6), at);
    if (/const\s+$/.test(before)) continue; // la declaración
    const rest = src.slice(at + name.length);
    const call = /^(?:\.(?:raw|rich|markup|has))?\(\s*(?:(['"])([^'"]+)\1|`([^`]*)`)/.exec(rest);
    if (call) {
      const key = call[2] ?? call[3];
      const literal = call[3] === undefined ? key : key.split('${')[0];
      if (call[3] !== undefined && key.includes('${') && !literal.includes('.')) return [ns];
      out.add(`${ns}.${literal.split('.')[0]}`);
      continue;
    }
    if (inDepsArray(src, at)) continue;
    return [ns];
  }
  return [...out];
}

export function fileInfo(file: string): FileInfo {
  const hit = cache.get(file);
  if (hit) return hit;
  const src = fs.readFileSync(file, 'utf8');
  const pre = ts.preProcessFile(src, true, true);
  const imports: string[] = [];
  for (const f of pre.importedFiles) {
    const r = resolveImport(file, f.fileName);
    if (r) imports.push(r);
  }
  const namespaces = new Set<string>();
  for (const m of src.matchAll(/(?:const\s+([A-Za-z_$][\w$]*)\s*=\s*)?useTranslations\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/g)) {
    const ns = m[3] || '*';
    for (const n of m[1] && ns !== '*' ? keyPrefixes(src, m[1], ns) : [ns]) namespaces.add(n);
  }
  // useTranslations(variable): no se puede saber qué lee.
  if (/useTranslations\(\s*[A-Za-z_$]/.test(src)) namespaces.add('*');
  if (/\buseMessages\(/.test(src) && !SCOPE_PROVIDERS.some((p) => file.endsWith(p))) namespaces.add('*');
  let provides: string[] | null = null;
  for (const m of src.matchAll(/<ClientMessages\b[^>]*?namespaces=\{\[([^\]]*)\]\}/g)) {
    provides = [...(provides ?? []), ...[...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])];
  }
  const info: FileInfo = { file, client: isClientSource(src), imports, namespaces: [...namespaces], provides };
  cache.set(file, info);
  return info;
}

/**
 * Namespaces que leen los componentes cliente alcanzables desde `entry`.
 * Un archivo cuenta como cliente si tiene 'use client' o si lo importa (directo
 * o no) un archivo cliente. Devuelve también qué archivo pide cada namespace.
 */
export function clientNamespacesFrom(entry: string): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Set<string>();
  const walk = (file: string, inClient: boolean) => {
    const key = `${inClient ? 'c' : 's'}:${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    const info = fileInfo(file);
    const client = inClient || info.client;
    if (client) for (const ns of info.namespaces) if (!out.has(ns)) out.set(ns, path.relative(ROOT, file));
    for (const imp of info.imports) walk(imp, client);
  };
  walk(entry, false);
  return out;
}

/** Archivos de segmento de Next que renderizan dentro del layout de su carpeta. */
const SEGMENT_FILES = ['page.tsx', 'loading.tsx', 'error.tsx', 'not-found.tsx', 'template.tsx', 'default.tsx', 'layout.tsx'];

export type SegmentCheck = { file: string; needs: Map<string, string>; provided: Set<string> };

/** Recorre app/ y, por cada archivo de segmento, junta lo que necesita y lo que le proveen sus layouts. */
export function checkRoutes(): SegmentCheck[] {
  const results: SegmentCheck[] = [];
  const visit = (dir: string, inherited: Set<string>) => {
    const provided = new Set(inherited);
    const layout = path.join(dir, 'layout.tsx');
    if (fs.existsSync(layout)) for (const ns of fileInfo(layout).provides ?? []) provided.add(ns);
    for (const name of SEGMENT_FILES) {
      const f = path.join(dir, name);
      if (!fs.existsSync(f)) continue;
      const own = new Set(provided);
      // Una página sin layout propio puede envolver su salida en ClientMessages.
      if (name !== 'layout.tsx') for (const ns of fileInfo(f).provides ?? []) own.add(ns);
      results.push({ file: path.relative(ROOT, f), needs: clientNamespacesFrom(f), provided: own });
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'api') visit(path.join(dir, entry.name), provided);
    }
  };
  visit(path.join(ROOT, 'app'), new Set());
  return results;
}
