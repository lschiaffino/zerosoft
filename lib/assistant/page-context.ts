/**
 * El registro abierto en la página: el panel manda el path y acá se traduce a
 * "qué es esto" con la operación del catálogo que lo lee. Así "resumí esto" o
 * "asignámelo" en un chat, un issue o una página de Docs no depende de que el
 * modelo adivine la forma de cada URL.
 */
export interface PageRecord {
  kind: string;
  id: string;
  /** Operación del catálogo que lo lee (run_operation, con args.path.id). */
  read: string;
}

const PATTERNS: Array<{ re: RegExp; kind: string; read: string }> = [
  { re: /^\/app\/docs\/([A-Za-z0-9_-]{6,64})(?:\/|$)/, kind: 'Docs page', read: 'v1.docs.pages.get' },
  { re: /^\/app\/track\/issue\/([A-Za-z0-9_-]{1,64})(?:\/|$)/, kind: 'Track issue', read: 'v1.track.issues.get' },
  { re: /^\/app\/track\/issues\/([A-Za-z0-9_-]{1,64})(?:\/|$)/, kind: 'Track issue', read: 'v1.track.issues.get' },
  { re: /^\/app\/track\/projects\/([A-Za-z0-9_-]{1,64})(?:\/|$)/, kind: 'Track project', read: 'v1.track.projects.get' },
  { re: /^\/app\/groups\/inbox\/([A-Za-z0-9_-]{1,64})(?:\/|$)/, kind: 'Groups chat', read: 'v1.groups.chats.get' },
  { re: /^\/app\/board\/([A-Za-z0-9_-]{6,64})(?:\/|$)/, kind: 'Board', read: 'v1.boards.get' },
  { re: /^\/app\/crm\/contacts\/([A-Za-z0-9_-]{6,64})(?:\/|$)/, kind: 'CRM contact', read: 'v1.crm.contacts.get' },
];

/** Docs usa rutas fijas al lado de [id]: no son páginas. */
const NOT_IDS = new Set(['settings', 'import', 'duplicate', 'invite', 'new', 'trash', 'templates']);

export function pageRecord(path: string | undefined | null): PageRecord | null {
  if (!path) return null;
  const clean = path.replace(/^\/(en|es|pt)(?=\/)/, '').split(/[?#]/)[0];
  for (const p of PATTERNS) {
    const m = p.re.exec(clean);
    if (m && !NOT_IDS.has(m[1])) return { kind: p.kind, id: m[1], read: p.read };
  }
  return null;
}
