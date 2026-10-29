/**
 * Agents — fuentes externas de conocimiento: el centro de ayuda de Zendesk
 * (Guide). Con el subdominio, el cron lee los artículos publicados por la
 * API pública del Help Center (sin token, hasta 500 artículos), los guarda
 * como páginas de conocimiento del agente (agent_knowledge_urls con origin
 * 'source:<id>', citables con su link) y los actualiza cada día: los
 * artículos que se borran en Zendesk salen del agente.
 *
 * Notion y Confluence entran por el importador de Docs (las páginas
 * importadas se usan como conocimiento como cualquier página de Docs).
 *
 * Las llamadas salen por safeFetch a <subdominio>.zendesk.com (host fijo).
 * Server-only.
 */
import { getDb } from './db';
import type { AgentRow } from './db';
import { readTextCapped, safeFetch } from './safe-fetch';
import { integrationsFake } from './agents-integrations';

export const AGENT_SOURCE_KINDS = ['zendesk'] as const;
export type AgentSourceKind = (typeof AGENT_SOURCE_KINDS)[number];
export const AGENT_MAX_SOURCES = 3;
const MAX_PAGES = 5;
const ARTICLE_MAX_CHARS = 60_000;

export interface AgentSourceDto {
  id: string;
  kind: AgentSourceKind;
  target: string;
  status: 'pending' | 'ok' | 'error';
  error: string | null;
  items: number;
  syncedAt: string | null;
}

export class SourceError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

/** "acme", "acme.zendesk.com" o "https://acme.zendesk.com/hc/es" → "acme.zendesk.com". */
export function normalizeZendesk(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
  const host = s.includes('.') ? s : `${s}.zendesk.com`;
  return /^[a-z0-9][a-z0-9-]{0,62}\.zendesk\.com$/.test(host) ? host : null;
}

function toDto(r: { id: string; kind: string; target: string; status: string; error: string | null; items: number; synced_at: string | null }): AgentSourceDto {
  return {
    id: r.id,
    kind: 'zendesk',
    target: r.target,
    status: r.status === 'ok' || r.status === 'error' ? r.status : 'pending',
    error: r.error,
    items: Number(r.items ?? 0),
    syncedAt: r.synced_at,
  };
}

export async function listSources(agentId: string): Promise<AgentSourceDto[]> {
  const rows = (await getDb()
    .prepare('SELECT id, kind, target, status, error, items, synced_at FROM agent_sources WHERE agent_id = ? ORDER BY created_at')
    .all(agentId)) as Parameters<typeof toDto>[0][];
  return rows.map(toDto);
}

export async function addSource(row: Pick<AgentRow, 'id' | 'user_id'>, kind: AgentSourceKind, rawTarget: string, personId: string): Promise<AgentSourceDto[]> {
  const target = normalizeZendesk(rawTarget);
  if (!target) throw new SourceError('invalid_zendesk');
  const db = getDb();
  const count = (await db.prepare('SELECT COUNT(*) AS c FROM agent_sources WHERE agent_id = ?').get(row.id)) as { c: number };
  if (Number(count.c) >= AGENT_MAX_SOURCES) throw new SourceError('too_many_sources');
  const res = await db
    .prepare("INSERT OR IGNORE INTO agent_sources (id, agent_id, user_id, kind, target, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
    .run(crypto.randomUUID(), row.id, row.user_id, kind, target, personId, new Date().toISOString());
  if (!res.changes) throw new SourceError('source_exists', 409);
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(row.user_id, row.id, personId, 'source_changed', { action: 'add', source: target });
  return listSources(row.id);
}

export async function removeSource(row: Pick<AgentRow, 'id' | 'user_id'>, sourceId: string, personId: string): Promise<AgentSourceDto[] | null> {
  const db = getDb();
  const src = (await db.prepare('SELECT target FROM agent_sources WHERE id = ? AND agent_id = ? AND user_id = ?').get(sourceId, row.id, row.user_id)) as
    | { target: string }
    | undefined;
  if (!src) return null;
  await db.prepare('DELETE FROM agent_knowledge_urls WHERE agent_id = ? AND origin = ?').run(row.id, `source:${sourceId}`);
  await db.prepare('DELETE FROM agent_sources WHERE id = ?').run(sourceId);
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(row.user_id, row.id, personId, 'source_changed', { action: 'remove', source: src.target });
  return listSources(row.id);
}

/** Vuelve a leer la fuente en la próxima corrida del cron. */
export async function resyncSource(row: Pick<AgentRow, 'id'>, sourceId: string): Promise<AgentSourceDto[] | null> {
  const res = await getDb()
    .prepare("UPDATE agent_sources SET status = 'pending', claimed_until = NULL WHERE id = ? AND agent_id = ?")
    .run(sourceId, row.id);
  return res.changes ? listSources(row.id) : null;
}

interface ZendeskArticle {
  title: string;
  url: string;
  body: string;
}

async function fetchZendeskArticles(host: string): Promise<ZendeskArticle[]> {
  if (integrationsFake()) {
    return [
      { title: 'Refund policy', url: `https://${host}/hc/en-us/articles/1-refund-policy`, body: '<p>You can ask for a refund within 30 days of your purchase.</p>' },
      { title: 'Shipping times', url: `https://${host}/hc/en-us/articles/2-shipping`, body: '<p>Orders ship in 2 business days.</p>' },
    ];
  }
  const out: ZendeskArticle[] = [];
  let url: string | null = `https://${host}/api/v2/help_center/articles.json?per_page=100&sort_by=updated_at`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await safeFetch(url, { headers: { accept: 'application/json', 'user-agent': 'Zerosoft-Agents/1' } }, 15_000);
    if (res.status === 404) throw new SourceError('zendesk_not_found');
    if (res.status === 401 || res.status === 403) throw new SourceError('zendesk_private');
    if (!res.ok) throw new SourceError(`zendesk_${res.status}`);
    const data = JSON.parse(await readTextCapped(res, 10_000_000)) as {
      articles?: Array<{ title?: string; html_url?: string; body?: string | null; draft?: boolean }>;
      next_page?: string | null;
    };
    for (const a of data.articles ?? []) {
      if (a.draft || !a.title || !a.html_url) continue;
      out.push({ title: a.title.slice(0, 200), url: a.html_url, body: a.body ?? '' });
    }
    // La próxima página tiene que ser del mismo host (no se sigue un link a otro lado).
    const next = data.next_page ? new URL(data.next_page) : null;
    url = next && next.hostname === host && next.protocol === 'https:' ? next.toString() : null;
  }
  return out;
}

async function syncSource(src: { id: string; agent_id: string; user_id: string; target: string }, token: string): Promise<void> {
  const db = getDb();
  const origin = `source:${src.id}`;
  try {
    const articles = await fetchZendeskArticles(src.target);
    const { htmlToText } = await import('./agents');
    const existing = (await db.prepare('SELECT id, url FROM agent_knowledge_urls WHERE agent_id = ? AND origin = ?').all(src.agent_id, origin)) as Array<{ id: string; url: string }>;
    const keep = new Set(articles.map((a) => a.url));
    for (const r of existing) if (!keep.has(r.url)) await db.prepare('DELETE FROM agent_knowledge_urls WHERE id = ?').run(r.id);
    const ts = new Date().toISOString();
    for (const a of articles) {
      const text = htmlToText(`<html><body>${a.body}</body></html>`).text.slice(0, ARTICLE_MAX_CHARS);
      await db
        .prepare(
          `INSERT INTO agent_knowledge_urls (id, agent_id, user_id, url, title, content, status, error, fetched_at, origin, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ok', NULL, ?, ?, ?)
           ON CONFLICT (agent_id, url) DO UPDATE SET title = excluded.title, content = excluded.content, status = 'ok', error = NULL, fetched_at = excluded.fetched_at, origin = excluded.origin`,
        )
        .run(crypto.randomUUID(), src.agent_id, src.user_id, a.url, a.title, text || a.title, ts, origin, ts);
    }
    await db
      .prepare("UPDATE agent_sources SET status = 'ok', error = NULL, items = ?, synced_at = ? WHERE id = ? AND claimed_until = ?")
      .run(articles.length, ts, src.id, token);
  } catch (err) {
    const code = err instanceof SourceError ? err.code : err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'zendesk_unreachable';
    await db
      .prepare("UPDATE agent_sources SET status = 'error', error = ?, synced_at = ? WHERE id = ? AND claimed_until = ?")
      .run(code, new Date().toISOString(), src.id, token);
  }
}

/** Cron de cada minuto: lee las fuentes nuevas y las de más de un día. Claim por fila. */
export async function processPendingSources(opts: { limit?: number; now?: Date } = {}): Promise<number> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const stale = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const due = `(status = 'pending' OR synced_at IS NULL OR synced_at < ?) AND (claimed_until IS NULL OR claimed_until < ?)`;
  const rows = (await db
    .prepare(`SELECT id, agent_id, user_id, target FROM agent_sources WHERE ${due} ORDER BY COALESCE(synced_at, '') ASC LIMIT ?`)
    .all(stale, now.toISOString(), Math.min(Math.max(opts.limit ?? 2, 1), 10))) as Array<{ id: string; agent_id: string; user_id: string; target: string }>;
  let done = 0;
  for (const r of rows) {
    const token = `${new Date(now.getTime() + 10 * 60_000).toISOString()}|${crypto.randomUUID().slice(0, 8)}`;
    const claimed = await db.prepare(`UPDATE agent_sources SET claimed_until = ? WHERE id = ? AND ${due}`).run(token, r.id, stale, now.toISOString());
    if (!claimed.changes) continue;
    await syncSource(r, token);
    done++;
  }
  return done;
}
