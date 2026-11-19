/**
 * Copia opcional del backlog del asistente como issues de GitHub, para el
 * loop diario que construye las ideas (corre en la nube, sin acceso a la app
 * pero con acceso a GitHub).
 *
 * - Solo con BACKLOG_GITHUB_REPO (owner/nombre, un repo PRIVADO) y
 *   BACKLOG_GITHUB_TOKEN. Sin las dos, no se manda nada a ningún lado.
 * - Un issue por ítem (roadmap_items.github_issue evita duplicados). Un
 *   pedido nuevo actualiza el cuerpo (cuántas personas lo pidieron) y una
 *   subida de prioridad agrega la etiqueta `priority`.
 * - El cuerpo nunca lleva email ni nombre de quien pidió: un id opaco
 *   (HMAC del id de la persona), lo que la persona escribió (sin emails ni
 *   teléfonos), la app, el conteo y el link interno al admin.
 * - Corre después de responder, con timeout; nunca bloquea ni rompe el chat.
 *   Una falla se registra (sin el token) y el tick horario reintenta
 *   (github_dirty > 0, compare-and-set con github_claimed_at, tope de intentos).
 */
import { createHmac } from 'crypto';
import { getDb } from './db';
import type { RoadmapItemRow } from './db';

export const BACKLOG_LABEL = 'from-assistant';
export const PRIORITY_LABEL = 'priority';
const TIMEOUT_MS = 10_000;
const CLAIM_MS = 5 * 60_000;
const MAX_ATTEMPTS = 10;
const NEEDS_MAX = 5;

export interface BacklogGithubConfig {
  repo: string;
  token: string;
}

export function backlogGithubConfig(): BacklogGithubConfig | null {
  const repo = (process.env.BACKLOG_GITHUB_REPO ?? '').trim();
  const token = (process.env.BACKLOG_GITHUB_TOKEN ?? '').trim();
  if (!repo || !token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { repo, token };
}

/** Id opaco y estable de quien pidió: no permite volver al email ni al nombre. */
export function requesterRef(personId: string): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'zerosoft-backlog';
  return `r_${createHmac('sha256', secret).update(`backlog-requester:${personId}`).digest('hex').slice(0, 12)}`;
}

/** Saca emails, teléfonos y links con datos de lo que escribió la persona. */
export function scrubText(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .trim();
}

function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

export function adminItemUrl(itemId: string): string {
  return `${appBase()}/app/settings/roadmap?view=list&item=${encodeURIComponent(itemId)}`;
}

export interface IssueInput {
  item: Pick<RoadmapItemRow, 'id' | 'title' | 'product' | 'status'> & { priority?: number };
  /** Personas distintas que lo pidieron. */
  people: number;
  /** Pedidos (señales) del asistente. */
  requests: number;
  /** Lo que escribió cada persona (del más nuevo al más viejo). */
  needs: string[];
  requesters: string[];
}

export interface IssuePayload {
  title: string;
  body: string;
  labels: string[];
}

/** Título, cuerpo y etiquetas del issue. Sin emails ni nombres. */
export function buildIssuePayload(input: IssueInput): IssuePayload {
  const priority = Number(input.item.priority ?? 0) === 1;
  const needs = input.needs.slice(0, NEEDS_MAX).map((n) => scrubText(n)).filter(Boolean);
  const body = [
    `**App:** ${input.item.product}`,
    `**Asked by:** ${input.people} ${input.people === 1 ? 'person' : 'people'} (${input.requests} ${input.requests === 1 ? 'request' : 'requests'})`,
    `**Priority:** ${priority ? 'yes, always build' : 'no'}`,
    `**Status:** ${input.item.status}`,
    '',
    '### What they need (in their words)',
    '',
    ...(needs.length ? needs.map((n) => `> ${n.replace(/\n+/g, '\n> ')}\n`) : ['> (no details)\n']),
    `**Requesters (opaque ids):** ${input.requesters.slice(0, 20).join(', ') || '-'}`,
    '',
    `**Admin:** ${adminItemUrl(input.item.id)}`,
    '',
    `<!-- zerosoft-backlog-item:${input.item.id} -->`,
  ].join('\n');
  return {
    title: scrubText(input.item.title).slice(0, 200) || 'Feature request',
    body,
    labels: priority ? [BACKLOG_LABEL, PRIORITY_LABEL] : [BACKLOG_LABEL],
  };
}

/** Lo que sale de la base para armar el issue. */
export async function issueInputFor(itemId: string): Promise<IssueInput | null> {
  const db = getDb();
  const item = (await db.prepare('SELECT * FROM roadmap_items WHERE id = ?').get(itemId)) as RoadmapItemRow | undefined;
  if (!item) return null;
  const signals = (await db
    .prepare(
      `SELECT f.user_id, f.message FROM roadmap_signals s JOIN feedback f ON f.id = s.source_id
       WHERE s.item_id = ? AND s.source = 'feedback' AND f.source = 'assistant'
       ORDER BY f.created_at DESC`,
    )
    .all(itemId)) as Array<{ user_id: string | null; message: string }>;
  const people = new Set(signals.map((s) => s.user_id).filter((v): v is string => Boolean(v)));
  const votes = (await db
    .prepare('SELECT user_id FROM roadmap_votes WHERE item_id = ? AND user_id IS NOT NULL')
    .all(itemId)) as Array<{ user_id: string }>;
  const everyone = new Set([...people, ...votes.map((v) => v.user_id)]);
  return {
    item,
    people: Math.max(1, everyone.size),
    requests: signals.length,
    needs: signals.map((s) => s.message),
    requesters: [...people].map(requesterRef),
  };
}

type FetchLike = typeof fetch;

async function github(cfg: BacklogGithubConfig, fetcher: FetchLike, method: string, path: string, body: unknown): Promise<Response> {
  return fetcher(`https://api.github.com/repos/${cfg.repo}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'zerosoft-backlog',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export type SyncOutcome = 'skipped' | 'busy' | 'sent' | 'failed';

/**
 * Manda el ítem a su issue (lo crea la primera vez). Claim por fila: dos
 * corridas a la vez nunca mandan lo mismo dos veces.
 */
export async function syncBacklogIssue(itemId: string, opts: { fetch?: FetchLike } = {}): Promise<SyncOutcome> {
  const cfg = backlogGithubConfig();
  if (!cfg) return 'skipped';
  const db = getDb();
  const now = new Date();
  const stale = new Date(now.getTime() - CLAIM_MS).toISOString();
  const claimed = await db
    .prepare(
      `UPDATE roadmap_items SET github_claimed_at = ?
       WHERE id = ? AND github_dirty > 0 AND github_attempts < ? AND (github_claimed_at IS NULL OR github_claimed_at < ?)`,
    )
    .run(now.toISOString(), itemId, MAX_ATTEMPTS, stale);
  if (claimed.changes === 0) return 'busy';
  const state = (await db.prepare('SELECT github_dirty, github_issue FROM roadmap_items WHERE id = ?').get(itemId)) as
    | { github_dirty: number; github_issue: number | null }
    | undefined;
  const input = await issueInputFor(itemId);
  if (!state || !input) return 'skipped';
  const payload = buildIssuePayload(input);
  const fetcher = opts.fetch ?? fetch;
  try {
    let issue = state.github_issue ? Number(state.github_issue) : null;
    if (!issue) {
      const res = await github(cfg, fetcher, 'POST', '/issues', payload);
      if (!res.ok) throw new Error(`create ${res.status}`);
      const data = (await res.json()) as { number?: number };
      if (!data.number) throw new Error('create without number');
      issue = data.number;
      await db.prepare('UPDATE roadmap_items SET github_issue = ? WHERE id = ?').run(issue, itemId);
    } else {
      // Solo el título y el cuerpo: las etiquetas que puso el loop (en curso, hecho…) quedan.
      const res = await github(cfg, fetcher, 'PATCH', `/issues/${issue}`, { title: payload.title, body: payload.body });
      if (!res.ok) throw new Error(`update ${res.status}`);
      const labels = await github(cfg, fetcher, 'POST', `/issues/${issue}/labels`, { labels: payload.labels });
      if (!labels.ok) throw new Error(`labels ${labels.status}`);
    }
    // Lo que llegó mientras se mandaba queda pendiente (se resta solo lo que se mandó).
    await db
      .prepare('UPDATE roadmap_items SET github_dirty = MAX(0, github_dirty - ?), github_claimed_at = NULL, github_attempts = 0 WHERE id = ?')
      .run(Number(state.github_dirty), itemId);
    return 'sent';
  } catch (err) {
    // Sin el token ni la respuesta: solo qué paso falló.
    const reason = err instanceof Error ? err.message.replace(/[^\w .:-]/g, '').slice(0, 80) : 'error';
    console.error(`[backlog] github sync failed for ${itemId}: ${reason}`);
    await db
      .prepare('UPDATE roadmap_items SET github_claimed_at = NULL, github_attempts = github_attempts + 1 WHERE id = ?')
      .run(itemId);
    return 'failed';
  }
}

/** Reintento del tick horario: los ítems con cambios sin mandar. */
export async function syncPendingBacklogIssues(opts: { limit?: number; fetch?: FetchLike } = {}): Promise<{ sent: number; failed: number } | null> {
  if (!backlogGithubConfig()) return null;
  const rows = (await getDb()
    .prepare('SELECT id FROM roadmap_items WHERE github_dirty > 0 AND github_attempts < ? ORDER BY priority DESC, updated_at ASC LIMIT ?')
    .all(MAX_ATTEMPTS, opts.limit ?? 20)) as Array<{ id: string }>;
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const out = await syncBacklogIssue(r.id, { fetch: opts.fetch });
    if (out === 'sent') sent++;
    else if (out === 'failed') failed++;
  }
  return { sent, failed };
}
