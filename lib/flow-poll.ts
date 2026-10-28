/**
 * Flow — disparador por polling (trigger.poll): cada N minutos (5 como
 * mínimo) consulta un feed RSS/Atom, una URL JSON o una hoja de Google Sheets
 * y corre el flow una vez por cada ítem nuevo. La primera consulta toma la
 * línea de base (marca lo que ya hay como visto, sin corridas), igual que
 * Zapier. Lo visto se guarda como claves (ids, no datos) en flow_flows.poll_state.
 *
 * Cada flow vencido se reclama con compare-and-set sobre next_poll_at (dos
 * crons a la vez no consultan dos veces). Todo el HTTP sale por safeFetch
 * (guardia SSRF) y las corridas quedan capturadas por quien creó el flow,
 * como cualquier disparador automático. Server-only.
 */
import { createHash } from 'crypto';
import { getDb, type FlowFlowRow } from './db';
import { enqueueRun, kickFlowWorker, nowIso, parseJson } from './flow';
import { resolveCredential, secretValues } from './flow-credentials';
import { redact } from './flow-credentials-schema';
import { StepError } from './flow-errors';
import { authHeaders, googleSheetsNode } from './flow-integrations';
import { POLL_MAX_MINUTES, POLL_MIN_MINUTES, triggerNode, type FlowGraph } from './flow-schema';
import { getPath } from './flow-template';
import { readTextCapped, safeFetch, UnsafeUrlError } from './safe-fetch';

/** Claves recordadas por flow (lo visto). */
const SEEN_LIMIT = 500;
/** Corridas por consulta como mucho: el resto queda para la próxima. */
const RUNS_PER_POLL = 20;
const POLL_TIMEOUT_MS = 10_000;
const POLL_BODY_LIMIT = 2_000_000;

export interface PollState {
  initialized: boolean;
  seen: string[];
  /** Sheets: filas de datos ya vistas (las nuevas son las que siguen). */
  count?: number;
  checkedAt?: string;
  error?: string | null;
}

export interface PollItem {
  key: string;
  data: Record<string, unknown>;
}

export function pollEveryMinutes(config: Record<string, unknown>): number {
  const n = Math.floor(Number(config.everyMinutes) || 15);
  return Math.min(Math.max(n, POLL_MIN_MINUTES), POLL_MAX_MINUTES);
}

// ---------- RSS / Atom ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&amp;/g, '&');
}

/**
 * Posición de la próxima etiqueta de apertura `<name` (seguida de espacio, `>`
 * o `/`) desde `from`, sin distinguir mayúsculas. Con indexOf: lineal (un
 * feed hostil de 2 MB no dispara backtracking de regex).
 */
function openTag(lower: string, name: string, from: number): number {
  const needle = `<${name}`;
  for (let i = lower.indexOf(needle, from); i >= 0; i = lower.indexOf(needle, i + 1)) {
    const c = lower[i + needle.length];
    if (c === '>' || c === '/' || c === ' ' || c === '\t' || c === '\n' || c === '\r') return i;
  }
  return -1;
}

function tagText(block: string, name: string): string {
  const lower = block.toLowerCase();
  const start = openTag(lower, name, 0);
  if (start < 0) return '';
  const gt = lower.indexOf('>', start);
  if (gt < 0 || lower[gt - 1] === '/') return '';
  const end = lower.indexOf(`</${name}>`, gt);
  if (end < 0) return '';
  const inner = block.slice(gt + 1, end).trim();
  if (inner.startsWith('<![CDATA[') && inner.endsWith(']]>')) return inner.slice(9, -3).trim();
  return decodeEntities(inner).trim();
}

/** Bloques `<item>…</item>` (o `<entry>`), recorridos con indexOf. */
function blocksOf(xml: string, lower: string, name: string, max: number): string[] {
  const out: string[] = [];
  let pos = 0;
  while (out.length < max) {
    const start = openTag(lower, name, pos);
    if (start < 0) break;
    const end = lower.indexOf(`</${name}>`, start);
    if (end < 0) break;
    out.push(xml.slice(start, end + name.length + 3));
    pos = end + name.length + 3;
  }
  return out;
}

function atomLink(block: string): string {
  const links: string[] = [];
  const lower = block.toLowerCase();
  for (let i = openTag(lower, 'link', 0); i >= 0 && links.length < 20; i = openTag(lower, 'link', i + 1)) {
    const gt = lower.indexOf('>', i);
    if (gt < 0) break;
    links.push(block.slice(i, gt + 1));
  }
  for (const l of links) {
    const href = /href\s*=\s*"([^"]*)"/i.exec(l)?.[1];
    const rel = /rel\s*=\s*"([^"]*)"/i.exec(l)?.[1] ?? 'alternate';
    if (href && rel === 'alternate') return decodeEntities(href);
  }
  return '';
}

/** Ítems de un feed RSS 2.0 o Atom (el orden del feed: suele ser el más nuevo primero). */
export function parseFeed(xml: string): Array<Record<string, string>> {
  const lower = xml.toLowerCase();
  const items = blocksOf(xml, lower, 'item', 200);
  const rss = items.length > 0;
  const blocks = rss ? items : blocksOf(xml, lower, 'entry', 200);
  return blocks.map((b) => {
    const link = rss ? tagText(b, 'link') : atomLink(b);
    const id = tagText(b, 'guid') || tagText(b, 'id') || link || tagText(b, 'title');
    return {
      id,
      title: tagText(b, 'title'),
      link,
      published: tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date'),
      summary: (tagText(b, 'description') || tagText(b, 'summary') || tagText(b, 'content')).slice(0, 5000),
      author: tagText(b, 'author') || tagText(b, 'dc:creator'),
    };
  });
}

function hashKey(v: unknown): string {
  return createHash('sha1').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 24);
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  let res: Response;
  try {
    res = await safeFetch(url, { method: 'GET', headers: { 'user-agent': 'Zerosoft-Flow/1', ...headers } }, POLL_TIMEOUT_MS, { maxRedirects: 5 });
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new StepError(err.message);
    throw new StepError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network_error', true);
  }
  // Leído en streaming con tope: un servidor no puede mandar un cuerpo infinito.
  const text = await readTextCapped(res, POLL_BODY_LIMIT).catch(() => '');
  if (!res.ok) throw new StepError(`http_${res.status}`, res.status >= 500 || res.status === 429);
  return text;
}

/**
 * Ítems actuales de la fuente, del más viejo al más nuevo, con su clave.
 * `secrets` recibe los valores de credenciales usados (para redactar errores).
 */
export async function fetchPollItems(
  flow: Pick<FlowFlowRow, 'id' | 'user_id' | 'created_by'>,
  config: Record<string, unknown>,
  secrets: string[] = [],
): Promise<PollItem[]> {
  const source = String(config.source ?? 'rss');
  if (source === 'google_sheets') {
    const res = await googleSheetsNode(
      {
        workspaceId: flow.user_id,
        actorId: flow.created_by,
        runId: `poll_${flow.id}`,
        nodeId: 'trigger',
        credential: async (id, types) => {
          const cred = await resolveCredential(flow.user_id, String(id ?? ''));
          if (!cred) throw new StepError(String(id ?? '').trim() ? 'credential_not_found' : 'missing_credential');
          if (!types.includes(cred.type)) throw new StepError('credential_wrong_type');
          secrets.push(...secretValues(cred.type, cred.data));
          return cred;
        },
        addSecret: (v) => {
          if (v && v.length >= 4) secrets.push(v);
        },
      },
      { credentialId: config.googleCredentialId, operation: 'read', spreadsheetId: config.spreadsheetId, range: config.range },
    );
    const rows = (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    return rows.map((row, i) => ({ key: `row:${i + 2}`, data: { ...row, rowNumber: i + 2 } }));
  }
  const url = String(config.url ?? '').trim();
  if (!url) throw new StepError('missing_url');
  if (source === 'json') {
    const headers: Record<string, string> = { accept: 'application/json' };
    const credId = String(config.credentialId ?? '').trim();
    if (credId) {
      const cred = await resolveCredential(flow.user_id, credId);
      if (!cred) throw new StepError('credential_not_found');
      if (!['api_key', 'basic', 'oauth_token'].includes(cred.type)) throw new StepError('credential_wrong_type');
      secrets.push(...secretValues(cred.type, cred.data));
      Object.assign(headers, authHeaders(cred));
    }
    let body: unknown;
    try {
      body = JSON.parse(await fetchText(url, headers));
    } catch (err) {
      if (err instanceof StepError) throw err;
      throw new StepError('invalid_json');
    }
    const path = String(config.itemsPath ?? '').trim();
    const list = path ? getPath(body, path) : body;
    if (!Array.isArray(list)) throw new StepError('poll_not_a_list');
    const idField = String(config.idField ?? 'id').trim();
    // Las APIs suelen listar lo más nuevo primero: se corre del más viejo al más nuevo.
    return list
      .slice(0, 500)
      .map((item) => {
        const id = idField ? getPath(item, idField) : undefined;
        const key = id !== undefined && id !== null && id !== '' ? `id:${String(id)}` : `h:${hashKey(item)}`;
        const data = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : { value: item };
        return { key, data };
      })
      .reverse();
  }
  const items = parseFeed(await fetchText(url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }));
  return items.map((it) => ({ key: `id:${it.id || hashKey(it)}`, data: { ...it, feed: { url } } })).reverse();
}

/** Qué ítems son nuevos según lo visto (y cómo queda lo visto después de correrlos). */
export function newPollItems(source: string, items: PollItem[], state: PollState): PollItem[] {
  if (source === 'google_sheets') {
    const count = Math.min(state.count ?? 0, items.length);
    return items.slice(count);
  }
  const seen = new Set(state.seen);
  return items.filter((i) => !seen.has(i.key));
}

function parseState(raw: string | null | undefined): PollState {
  const s = parseJson<Partial<PollState>>(raw, {});
  return { initialized: s.initialized === true, seen: Array.isArray(s.seen) ? s.seen.map(String).slice(0, SEEN_LIMIT) : [], count: Number(s.count) || 0 };
}

async function saveState(flowId: string, state: PollState): Promise<void> {
  await getDb().prepare('UPDATE flow_flows SET poll_state = ? WHERE id = ?').run(JSON.stringify(state), flowId);
}

/**
 * Consulta los flows con trigger.poll vencidos y encola una corrida por ítem
 * nuevo. La llama el worker (cron por minuto). Devuelve las corridas encoladas.
 */
export async function enqueueDuePolls(now: Date = new Date(), opts: { limit?: number; deadline?: number } = {}): Promise<number> {
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM flow_flows WHERE enabled = 1 AND trigger_type = 'trigger.poll'
         AND next_poll_at IS NOT NULL AND next_poll_at <= ? ORDER BY next_poll_at LIMIT ?`,
    )
    .all(now.toISOString(), Math.min(Math.max(opts.limit ?? 10, 1), 50))) as FlowFlowRow[];
  let enqueued = 0;
  for (const row of rows) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
    const graph = parseJson<FlowGraph>(row.graph, { nodes: [], edges: [] });
    const trigger = triggerNode(graph);
    if (!trigger || trigger.type !== 'trigger.poll') continue;
    const next = new Date(now.getTime() + pollEveryMinutes(trigger.config) * 60_000).toISOString();
    const claimed = await getDb()
      .prepare('UPDATE flow_flows SET next_poll_at = ? WHERE id = ? AND next_poll_at = ?')
      .run(next, row.id, row.next_poll_at ?? null);
    if (claimed.changes !== 1 || !row.created_by) continue;
    const state = parseState(row.poll_state);
    const source = String(trigger.config.source ?? 'rss');
    const secrets: string[] = [];
    let items: PollItem[];
    try {
      items = await fetchPollItems(row, trigger.config, secrets);
    } catch (err) {
      const code = err instanceof StepError ? err.code : 'poll_failed';
      await saveState(row.id, { ...state, checkedAt: nowIso(), error: secrets.length ? redact(code, secrets) : code });
      continue;
    }
    if (!state.initialized) {
      // Línea de base: lo que ya está no dispara corridas.
      await saveState(row.id, {
        initialized: true,
        seen: items.map((i) => i.key).reverse().slice(0, SEEN_LIMIT),
        count: items.length,
        checkedAt: nowIso(),
        error: null,
      });
      continue;
    }
    const fresh = newPollItems(source, items, state).slice(0, RUNS_PER_POLL);
    const done: PollItem[] = [];
    for (const item of fresh) {
      const id = await enqueueRun(row, 'trigger.poll', item.data, { automatic: true });
      if (!id) break; // Tope del workspace: lo que falta queda para la próxima consulta.
      done.push(item);
      enqueued += 1;
    }
    const seen = [...done.map((i) => i.key).reverse(), ...state.seen].slice(0, SEEN_LIMIT);
    const count = source === 'google_sheets' ? Math.min(state.count ?? 0, items.length) + done.length : items.length;
    await saveState(row.id, { initialized: true, seen, count, checkedAt: nowIso(), error: null });
  }
  if (enqueued) kickFlowWorker();
  return enqueued;
}
