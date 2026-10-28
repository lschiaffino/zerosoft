/**
 * Flow — formatos para mover flows y nodos: el JSON de exportar/importar un
 * flow, lo que va al portapapeles al copiar nodos (entre flows y pestañas) y
 * el import de un comando cURL al nodo HTTP. Sin dependencias de servidor:
 * lo usan el editor y las rutas.
 */
import { isTriggerType, type FlowEdge, type FlowGraph, type FlowNode } from './flow-schema';

export const FLOW_EXPORT_FORMAT = 'zerosoft-flow';
export const FLOW_CLIPBOARD_FORMAT = 'zerosoft-flow-nodes';

export interface FlowExport {
  format: typeof FLOW_EXPORT_FORMAT;
  version: 1;
  name: string;
  description: string;
  graph: FlowGraph;
  exportedAt: string;
}

export function exportFlowJson(flow: { name: string; description: string; graph: FlowGraph }, now = new Date()): FlowExport {
  return { format: FLOW_EXPORT_FORMAT, version: 1, name: flow.name, description: flow.description, graph: flow.graph, exportedAt: now.toISOString() };
}

/** Nombre de archivo para descargar (sin caracteres raros). */
export function exportFileName(name: string): string {
  const base = name.trim().replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, '-').slice(0, 60) || 'flow';
  return `${base}.flow.json`;
}

/** Lee un JSON exportado (de Flow); acepta también { name, graph } a secas. null si no es un flow. */
export function parseFlowImport(text: string): { name: string; description: string; graph: unknown } | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const graph = o.graph && typeof o.graph === 'object' ? o.graph : 'nodes' in o && 'edges' in o ? { nodes: o.nodes, edges: o.edges } : null;
  if (!graph) return null;
  return {
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 120) : 'Imported flow',
    description: typeof o.description === 'string' ? o.description.slice(0, 1000) : '',
    graph,
  };
}

// ---------- Copiar y pegar nodos ----------

export interface NodesClipboard {
  format: typeof FLOW_CLIPBOARD_FORMAT;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** Lo copiado: los nodos elegidos y las conexiones entre ellos. */
export function copyNodes(graph: FlowGraph, ids: string[]): NodesClipboard {
  const set = new Set(ids);
  return {
    format: FLOW_CLIPBOARD_FORMAT,
    nodes: graph.nodes.filter((n) => set.has(n.id)),
    edges: graph.edges.filter((e) => set.has(e.source) && set.has(e.target)),
  };
}

export function parseClipboard(text: string): NodesClipboard | null {
  try {
    const v = JSON.parse(text) as Partial<NodesClipboard>;
    if (v?.format !== FLOW_CLIPBOARD_FORMAT || !Array.isArray(v.nodes)) return null;
    return { format: FLOW_CLIPBOARD_FORMAT, nodes: v.nodes.slice(0, 100), edges: Array.isArray(v.edges) ? v.edges.slice(0, 300) : [] };
  } catch {
    return null;
  }
}

/**
 * Pega nodos en un grafo: ids nuevos (sin chocar), corridos de lugar, y las
 * conexiones internas con los ids nuevos. Un trigger no se pega si el flow
 * ya tiene uno. Las referencias {{nodes.<id>}} en la config se renombran.
 */
export function pasteNodes(graph: FlowGraph, clip: NodesClipboard, offset = { x: 40, y: 40 }): { graph: FlowGraph; added: string[] } {
  const existing = new Set(graph.nodes.map((n) => n.id));
  const hasTrigger = graph.nodes.some((n) => isTriggerType(n.type));
  const rename = new Map<string, string>();
  const nodes: FlowNode[] = [];
  for (const n of clip.nodes) {
    if (!n || typeof n.id !== 'string' || typeof n.type !== 'string') continue;
    if (isTriggerType(n.type) && (hasTrigger || nodes.some((x) => isTriggerType(x.type)))) continue;
    const base = n.id.replace(/_\d+$/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'node';
    let id = n.id;
    for (let i = 1; existing.has(id) || id.length > 40 || !/^[A-Za-z0-9_-]+$/.test(id); i++) id = `${base}_${i}`;
    existing.add(id);
    rename.set(n.id, id);
    nodes.push({ ...n, id, position: { x: (n.position?.x ?? 0) + offset.x, y: (n.position?.y ?? 0) + offset.y }, config: n.config ?? {} });
  }
  const renameRefs = (text: string) =>
    text.replace(/nodes\.([A-Za-z0-9_-]+)/g, (m, id: string) => (rename.has(id) ? `nodes.${rename.get(id)}` : m));
  const deep = (v: unknown): unknown =>
    typeof v === 'string' ? renameRefs(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v;
  for (const n of nodes) n.config = deep(n.config) as Record<string, unknown>;
  const edges: FlowEdge[] = [];
  for (const e of clip.edges) {
    const s = rename.get(e.source);
    const t = rename.get(e.target);
    if (!s || !t) continue;
    edges.push({ id: `e_${s}_${e.sourceHandle ?? 'out'}_${t}`.slice(0, 100), source: s, target: t, sourceHandle: e.sourceHandle ?? 'out' });
  }
  return { graph: { nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] }, added: nodes.map((n) => n.id) };
}

// ---------- Importar cURL ----------

export interface CurlImport {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body: string;
}

/** Separa un comando de shell en palabras (comillas simples, dobles, \ y saltos con \). */
export function shellWords(cmd: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  const s = cmd.replace(/\\\r?\n/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

/**
 * Lee un `curl ...` (como el que copian las docs de una API o "Copy as cURL"
 * del navegador) y devuelve método, URL, headers y cuerpo. null si no es un
 * comando curl con URL. Los headers de autenticación quedan como están: el
 * editor sugiere pasarlos a una credencial.
 */
export function parseCurl(cmd: string): CurlImport | null {
  const words = shellWords(cmd.trim());
  if (words[0]?.replace(/^.*\//, '') !== 'curl') return null;
  let method = '';
  let url = '';
  const headers: Array<{ key: string; value: string }> = [];
  const data: string[] = [];
  let user = '';
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const next = () => words[++i] ?? '';
    if (w === '-X' || w === '--request') method = next().toUpperCase();
    else if (w.startsWith('-X') && w.length > 2) method = w.slice(2).toUpperCase();
    else if (w === '-H' || w === '--header') {
      const h = next();
      const j = h.indexOf(':');
      if (j > 0) headers.push({ key: h.slice(0, j).trim(), value: h.slice(j + 1).trim() });
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--json'].includes(w)) {
      data.push(next());
      if (w === '--json') {
        if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) headers.push({ key: 'Content-Type', value: 'application/json' });
      }
    } else if (w === '--data-urlencode') data.push(next());
    else if (w === '-u' || w === '--user') user = next();
    else if (w === '--url') url = next();
    else if (['-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-o', '--output', '-m', '--max-time', '--connect-timeout'].includes(w)) next();
    else if (w.startsWith('-')) continue;
    else if (!url) url = w;
  }
  if (!/^https?:\/\//i.test(url)) return null;
  if (user) {
    const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(user))) : Buffer.from(user).toString('base64');
    headers.push({ key: 'Authorization', value: `Basic ${b64}` });
  }
  const body = data.join('&');
  const m = method || (body ? 'POST' : 'GET');
  return { method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m) ? m : 'POST', url, headers, body };
}

/** ¿El header lleva un secreto? (el editor sugiere pasarlo a una credencial). */
export function isAuthHeader(key: string): boolean {
  return /^(authorization|x-api-key|api-key|x-auth-token|cookie)$/i.test(key.trim());
}
