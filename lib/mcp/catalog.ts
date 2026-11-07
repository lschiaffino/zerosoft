/** Catálogo de operaciones del MCP. Sale de scripts/mcp-catalog.mjs; ver docs/mcp.md. */
import { CATALOG_JSON } from './catalog.generated';
import { PRODUCT_CONFIG, PRODUCT_KEYS, type ProductKey } from '../products';

export type OperationAccess = 'read' | 'write' | 'destructive';
export type SchemaQuality = 'real' | 'partial' | 'loose';

export type JsonSchema = Record<string, unknown>;

export interface Operation {
  id: string;
  app: ProductKey | 'workspace';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  access: OperationAccess;
  quality: SchemaQuality;
  session: boolean;
  body: 'json' | 'form' | 'both' | 'none';
  params: string[];
  inputSchema: { type: 'object'; properties: Record<string, JsonSchema>; required?: string[]; additionalProperties?: boolean };
  doc: string;
  /** Lectura que igual queda en la auditoría (exportaciones, datos sensibles). */
  audit?: boolean;
}

export interface WebOnlyOperation {
  id: string;
  app: string;
  method: string;
  path: string;
  where: string;
}

const raw = JSON.parse(CATALOG_JSON) as {
  operations: Operation[];
  webOnly: WebOnlyOperation[];
  excluded: Array<{ path: string; method: string; reason: string }>;
};

export const OPERATIONS = raw.operations;
export const EXCLUDED = raw.excluded;
export const WEB_ONLY = raw.webOnly;

const byId = new Map(OPERATIONS.map((o) => [o.id, o]));

export function getOperation(id: unknown): Operation | null {
  return typeof id === 'string' ? (byId.get(id) ?? null) : null;
}

const webOnlyById = new Map(WEB_ONLY.map((o) => [o.id, o]));

/** Lo que existe pero se hace desde la web, para explicarlo en vez de decir que no existe. */
export function getWebOnly(id: unknown): WebOnlyOperation | null {
  return typeof id === 'string' ? (webOnlyById.get(id) ?? null) : null;
}

export function webOnlyMessage(op: WebOnlyOperation): string {
  return `${op.id} creates a credential or a shareable link, or stores third-party keys, so it is not available here. The person can do it in zerosoft: ${op.where}.`;
}

/** Título legible a partir del id: crm.deals.move → "Crm deals move". */
export function operationTitle(op: Operation): string {
  const words = op.id.replace(/^v1\./, '').split(/[._]/).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Anotaciones MCP de una operación: lo destructivo y la lectura se dicen, lo demás se trata como escritura. */
export function operationAnnotations(op: Operation) {
  return {
    title: operationTitle(op),
    readOnlyHint: op.access === 'read',
    destructiveHint: op.access === 'destructive',
    idempotentHint: op.method === 'GET' || op.method === 'PUT' || op.method === 'DELETE',
    openWorldHint: true,
  };
}

export const APP_NAMES: Record<string, string> = {
  ...Object.fromEntries(PRODUCT_KEYS.map((k) => [k, PRODUCT_CONFIG[k].name])),
  workspace: 'Workspace',
};

export interface OperationSummary {
  id: string;
  app: string;
  title: string;
  access: OperationAccess;
  method: string;
  path: string;
  doc?: string;
  schema: SchemaQuality;
}

export function summarize(op: Operation): OperationSummary {
  return {
    id: op.id,
    app: op.app,
    title: operationTitle(op),
    access: op.access,
    method: op.method,
    path: op.path,
    ...(op.doc ? { doc: op.doc.slice(0, 160) } : {}),
    schema: op.quality,
  };
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Búsqueda por palabras sobre id, path y documentación; el id pesa más que el comentario. */
export function searchOperations(input: {
  query?: string;
  app?: string;
  access?: OperationAccess;
  allowed: (op: Operation) => boolean;
}): Operation[] {
  const words = norm(input.query ?? '').split(/[\s._/-]+/).filter(Boolean);
  const scored: Array<{ op: Operation; score: number }> = [];
  for (const op of OPERATIONS) {
    if (input.app && op.app !== input.app) continue;
    if (input.access && op.access !== input.access) continue;
    if (!input.allowed(op)) continue;
    const id = norm(op.id);
    const path = norm(op.path);
    const doc = norm(op.doc);
    let score = 0;
    let all = true;
    for (const w of words) {
      const stem = w.replace(/s$/, '');
      const inId = id.includes(stem);
      const inPath = path.includes(stem);
      const inDoc = doc.includes(stem);
      if (!inId && !inPath && !inDoc) { all = false; break; }
      score += (inId ? 5 : 0) + (inPath ? 2 : 0) + (inDoc ? 1 : 0);
    }
    if (!all) continue;
    // Las operaciones de la app van antes que sus equivalentes de la API v1.
    if (!op.id.startsWith('v1.')) score += 1;
    scored.push({ op, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.op.id.length - b.op.id.length || a.op.id.localeCompare(b.op.id)).map((s) => s.op);
}
