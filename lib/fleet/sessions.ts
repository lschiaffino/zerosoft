/**
 * Fleet: agentes locales (Claude Code, también dentro de Orca). Tokens de ingesta, eventos del hook, sesiones, su
 * conversación y la cola de respuestas que entrega el Stop hook. Server-only.
 *
 * Seguridad:
 * - El token de ingesta (zsf_…) se muestra una sola vez; se guarda su SHA-256. Cada token es de una persona en un
 *   workspace y todo lo que entra con él queda en ese par: una sesión de otra persona con el mismo session_id es
 *   otra fila.
 * - Se guarda solo lo de la lista (evento, id de sesión, nombre de la carpeta, rama, ids de Orca, prompt y última
 *   respuesta recortados y sin secretos reconocibles, estado). Nunca rutas completas, transcripts ni archivos.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db';
import { itemsForBranches, nowIso, pushFeed, type FleetActor } from './core';
import {
  FleetError,
  LIMITS,
  clip,
  hookOutput,
  oneLine,
  redactSecrets,
  sessionRank,
  statusAfter,
  type IngestEvent,
  type MessageDto,
  type MessageRole,
  type ReplySource,
  type SessionDto,
  type SessionStatus,
} from './types';

const db = () => getDb();

export const TOKEN_PREFIX = 'zsf_';
export const MAX_TOKENS = 10;
/** Mensajes por sesión que se guardan (los más viejos se borran). */
export const MAX_MESSAGES_PER_SESSION = 500;
/** Respuestas pendientes por sesión. */
export const MAX_PENDING = 20;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// ---------- Tokens ----------

export interface TokenDto {
  id: string;
  label: string;
  hint: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function listTokens(actor: FleetActor): Promise<TokenDto[]> {
  const rows = (await db()
    .prepare('SELECT id, label, token_hint, last_used_at, created_at FROM fleet_tokens WHERE workspace_id = ? AND person_id = ? ORDER BY created_at')
    .all(actor.ws, actor.person)) as Array<{ id: string; label: string; token_hint: string; last_used_at: string | null; created_at: string }>;
  return rows.map((r) => ({ id: r.id, label: r.label, hint: r.token_hint, lastUsedAt: r.last_used_at, createdAt: r.created_at }));
}

/** Crea un token de ingesta. El token en claro se devuelve solo acá. */
export async function createToken(actor: FleetActor, label: string): Promise<{ token: string; item: TokenDto }> {
  const n = (await db().prepare('SELECT COUNT(*) AS n FROM fleet_tokens WHERE workspace_id = ? AND person_id = ?').get(actor.ws, actor.person)) as { n: number };
  if (Number(n.n) >= MAX_TOKENS) throw new FleetError('too_many_tokens', 400);
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
  const id = randomUUID();
  const ts = nowIso();
  const clean = clip(label.trim(), LIMITS.label);
  await db()
    .prepare('INSERT INTO fleet_tokens (id, workspace_id, person_id, label, token_hash, token_hint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, actor.person, clean, sha256(token), token.slice(-4), ts);
  return { token, item: { id, label: clean, hint: token.slice(-4), lastUsedAt: null, createdAt: ts } };
}

export async function deleteToken(actor: FleetActor, id: string): Promise<void> {
  const res = await db().prepare('DELETE FROM fleet_tokens WHERE id = ? AND workspace_id = ? AND person_id = ?').run(id, actor.ws, actor.person);
  if (!res.changes) throw new FleetError('not_found', 404);
}

export interface IngestOwner {
  tokenId: string;
  ws: string;
  person: string;
}

/** Resuelve el token del header Authorization (Bearer zsf_…). null si no es válido. */
export async function ownerOfToken(raw: string | null | undefined): Promise<IngestOwner | null> {
  const token = (raw ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20 || token.length > 100) return null;
  const row = (await db().prepare('SELECT id, workspace_id, person_id, last_used_at FROM fleet_tokens WHERE token_hash = ?').get(sha256(token))) as
    | { id: string; workspace_id: string; person_id: string; last_used_at: string | null }
    | undefined;
  if (!row) return null;
  // last_used_at con resolución de un minuto: no una escritura por evento.
  const now = Date.now();
  if (!row.last_used_at || now - Date.parse(row.last_used_at) > 60_000) {
    await db().prepare('UPDATE fleet_tokens SET last_used_at = ? WHERE id = ?').run(new Date(now).toISOString(), row.id);
  }
  return { tokenId: row.id, ws: row.workspace_id, person: row.person_id };
}

// ---------- Ingesta ----------

interface SessionRow {
  id: string;
  workspace_id: string;
  person_id: string;
  session_key: string;
  title: string;
  custom_title: string;
  project: string;
  branch: string;
  orca_pane: string;
  orca_worktree: string;
  orca_tab: string;
  status: SessionStatus;
  last_text: string;
  unread: number;
  archived: number;
  started_at: string;
  last_event_at: string;
  updated_at: string;
}

const ROLE_OF: Record<IngestEvent['event'], MessageRole | null> = {
  UserPromptSubmit: 'prompt',
  Stop: 'agent',
  Notification: 'notice',
  SubagentStop: 'notice',
  StopFailure: 'notice',
  SessionStart: 'notice',
  SessionEnd: 'notice',
};

export interface IngestResult {
  sessionId: string;
  status: SessionStatus;
  /** Lo que el hook imprime en stdout (contrato de Claude Code). */
  output: Record<string, unknown>;
  /** Mensajes entregados con esta respuesta. */
  delivered: number;
}

async function findSession(owner: Pick<IngestOwner, 'ws' | 'person'>, key: string): Promise<SessionRow | null> {
  return ((await db().prepare('SELECT * FROM fleet_sessions WHERE workspace_id = ? AND person_id = ? AND session_key = ?').get(owner.ws, owner.person, key)) as SessionRow | undefined) ?? null;
}

async function trimMessages(sessionId: string): Promise<void> {
  await db()
    .prepare(
      `DELETE FROM fleet_messages WHERE session_id = ? AND id NOT IN (SELECT id FROM fleet_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?) AND status != 'pending'`,
    )
    .run(sessionId, sessionId, MAX_MESSAGES_PER_SESSION);
}

/**
 * Un evento del hook. Crea la sesión la primera vez, guarda el mensaje que corresponde, actualiza el estado y,
 * en Stop/SubagentStop/UserPromptSubmit, entrega las respuestas en cola (las marca entregadas en el mismo paso:
 * compare-and-set de status, así dos hooks a la vez no entregan lo mismo dos veces).
 */
export async function ingestEvent(owner: IngestOwner, ev: IngestEvent, now = new Date()): Promise<IngestResult> {
  const ts = nowIso(now);
  let row = await findSession(owner, ev.sessionKey);
  if (!row) {
    const id = randomUUID();
    await db()
      .prepare(
        `INSERT INTO fleet_sessions (id, workspace_id, person_id, token_id, session_key, title, project, branch, orca_pane, orca_worktree, orca_tab, status, last_text, unread, archived, started_at, last_event_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 'idle', '', 0, 0, ?, ?, ?)
         ON CONFLICT(workspace_id, person_id, session_key) DO NOTHING`,
      )
      .run(id, owner.ws, owner.person, owner.tokenId, ev.sessionKey, ev.project, ev.branch, ev.orcaPane, ev.orcaWorktree, ev.orcaTab, ts, ts, ts);
    row = (await findSession(owner, ev.sessionKey)) as SessionRow;
  }
  const status = statusAfter(row.status, ev);
  const role = ROLE_OF[ev.event];
  let text = ev.text;
  if (ev.event === 'SubagentStop' && !text) text = '';
  // Mensaje: los prompts y respuestas siempre; los avisos solo si dicen algo.
  const keep = role === 'prompt' || role === 'agent' ? Boolean(text) : ev.event === 'Notification' ? Boolean(text) : ev.event !== 'SubagentStop' || Boolean(ev.detail || text);
  if (role && keep) {
    await db()
      .prepare('INSERT INTO fleet_messages (id, session_id, workspace_id, person_id, role, event, text, status, source, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), row.id, owner.ws, owner.person, role, ev.detail ? `${ev.event}:${ev.detail}` : ev.event, text, '', 'hook', '', ts);
  }
  const title = row.title || (ev.event === 'UserPromptSubmit' && text ? oneLine(text, LIMITS.title) : '');
  const lastText = role === 'agent' || role === 'prompt' ? oneLine(text, 300) : ev.event === 'Notification' && text ? oneLine(text, 300) : row.last_text;
  // Sin leer: lo que dice el agente (respuesta, aviso que te espera o falla).
  const unreadInc = ev.event === 'Stop' || (ev.event === 'Notification' && status === 'waiting') || ev.event === 'StopFailure' ? 1 : 0;
  await db()
    .prepare(
      `UPDATE fleet_sessions SET status = ?, title = ?, last_text = ?, unread = unread + ?, archived = 0, last_event_at = ?, updated_at = ?,
         project = CASE WHEN ? != '' THEN ? ELSE project END, branch = CASE WHEN ? != '' THEN ? ELSE branch END,
         orca_pane = CASE WHEN ? != '' THEN ? ELSE orca_pane END, orca_worktree = CASE WHEN ? != '' THEN ? ELSE orca_worktree END,
         orca_tab = CASE WHEN ? != '' THEN ? ELSE orca_tab END
       WHERE id = ?`,
    )
    .run(status, title, lastText, unreadInc, ts, ts, ev.project, ev.project, ev.branch, ev.branch, ev.orcaPane, ev.orcaPane, ev.orcaWorktree, ev.orcaWorktree, ev.orcaTab, ev.orcaTab, row.id);

  let delivered: Array<{ id: string; text: string; source: string }> = [];
  if (ev.event === 'Stop' || ev.event === 'UserPromptSubmit' || ev.event === 'SubagentStop') {
    // SubagentStop: la respuesta va al agente principal, no al subagente: se entrega en su Stop.
    if (ev.event !== 'SubagentStop') delivered = await claimPending(row.id, ts);
  }
  if (delivered.length) {
    // Entregada: el agente sigue trabajando con eso.
    await db().prepare("UPDATE fleet_sessions SET status = 'working', updated_at = ? WHERE id = ?").run(ts, row.id);
  }
  await trimMessages(row.id);
  await pushFeed(owner.ws, owner.person, 'session', row.id);
  if (role && keep) await pushFeed(owner.ws, owner.person, 'message', row.id);

  // Avisos por WhatsApp (a tu propio chat) y espejo en Inbox: después, sin trabar el hook.
  if (ev.event === 'Stop' || (ev.event === 'Notification' && status === 'waiting') || ev.event === 'StopFailure') {
    if (!delivered.length) {
      const { afterAgentEvent } = await import('./link');
      await afterAgentEvent(owner, row.id, status, text).catch((err) => console.error('[fleet] notify', err instanceof Error ? err.message : 'error'));
    }
  }

  return { sessionId: row.id, status: delivered.length ? 'working' : status, output: hookOutput(ev.event, delivered), delivered: delivered.length };
}

/** Toma las respuestas pendientes de la sesión y las marca entregadas (compare-and-set por fila). */
async function claimPending(sessionId: string, ts: string): Promise<Array<{ id: string; text: string; source: string }>> {
  const rows = (await db()
    .prepare("SELECT id, text, source FROM fleet_messages WHERE session_id = ? AND role = 'reply' AND status = 'pending' ORDER BY created_at LIMIT ?")
    .all(sessionId, MAX_PENDING)) as Array<{ id: string; text: string; source: string }>;
  const out: typeof rows = [];
  for (const r of rows) {
    const res = await db().prepare("UPDATE fleet_messages SET status = 'delivered', delivered_at = ? WHERE id = ? AND status = 'pending'").run(ts, r.id);
    if (res.changes === 1) out.push(r);
  }
  return out;
}

/**
 * Espera corta del Stop hook en modo "esperar respuesta": devuelve las pendientes apenas hay alguna o null al
 * vencer. La sesión queda "te espera" mientras tanto.
 */
export async function waitForReply(owner: IngestOwner, sessionKey: string, maxMs: number): Promise<Record<string, unknown> | null> {
  const row = await findSession(owner, sessionKey);
  if (!row) return null;
  const deadline = Date.now() + Math.max(0, Math.min(maxMs, 25_000));
  for (;;) {
    const ts = nowIso();
    const delivered = await claimPending(row.id, ts);
    if (delivered.length) {
      await db().prepare("UPDATE fleet_sessions SET status = 'working', updated_at = ? WHERE id = ?").run(ts, row.id);
      await pushFeed(owner.ws, owner.person, 'session', row.id);
      await pushFeed(owner.ws, owner.person, 'message', row.id);
      return hookOutput('Stop', delivered);
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---------- Lectura ----------

function sessionDto(r: SessionRow & { pending?: number }): SessionDto {
  return {
    id: r.id,
    title: r.custom_title || r.title || r.project || r.branch || r.session_key.slice(0, 8),
    project: r.project,
    branch: r.branch,
    orcaPane: r.orca_pane,
    orcaWorktree: r.orca_worktree,
    status: r.status,
    lastText: r.last_text,
    unread: Number(r.unread) || 0,
    pending: Number(r.pending ?? 0) || 0,
    archived: Number(r.archived) === 1,
    startedAt: r.started_at,
    lastEventAt: r.last_event_at,
    pr: null,
    deploy: null,
  };
}

/** Sesiones de la persona con su PR y su deploy por rama, las que te esperan primero. */
export async function listSessions(actor: FleetActor, opts: { archived?: boolean; limit?: number; ids?: string[] } = {}): Promise<SessionDto[]> {
  const where = ['s.workspace_id = ?', 's.person_id = ?'];
  const args: Array<string | number> = [actor.ws, actor.person];
  if (opts.ids) {
    if (!opts.ids.length) return [];
    where.push(`s.id IN (${opts.ids.map(() => '?').join(',')})`);
    args.push(...opts.ids);
  } else {
    where.push('s.archived = ?');
    args.push(opts.archived ? 1 : 0);
  }
  const rows = (await db()
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM fleet_messages m WHERE m.session_id = s.id AND m.role = 'reply' AND m.status = 'pending') AS pending
       FROM fleet_sessions s WHERE ${where.join(' AND ')} ORDER BY s.last_event_at DESC LIMIT ?`,
    )
    .all(...args, opts.limit ?? 200)) as Array<SessionRow & { pending: number }>;
  const list = rows.map(sessionDto);
  const { pulls, deploys } = await itemsForBranches(
    actor,
    list.map((s) => s.branch),
  );
  for (const s of list) {
    if (!s.branch) continue;
    const pr = pulls.find((p) => p.branch === s.branch);
    if (pr) s.pr = { id: pr.id, repo: pr.repo, number: pr.number, url: pr.url, checks: pr.checks, autoMerge: pr.autoMerge, title: pr.title };
    const dp = deploys.find((d) => d.branch === s.branch);
    if (dp) s.deploy = { id: dp.id, project: dp.project, state: dp.state, url: dp.url, target: dp.target, serving: dp.serving };
  }
  return list.sort((a, b) => sessionRank(a.status) - sessionRank(b.status) || b.lastEventAt.localeCompare(a.lastEventAt));
}

export async function getSession(actor: FleetActor, id: string): Promise<SessionDto> {
  const [s] = await listSessions(actor, { ids: [id] });
  if (!s) throw new FleetError('not_found', 404);
  return s;
}

async function ownSession(actor: FleetActor, id: string): Promise<SessionRow> {
  const row = (await db().prepare('SELECT * FROM fleet_sessions WHERE id = ? AND workspace_id = ? AND person_id = ?').get(id, actor.ws, actor.person)) as SessionRow | undefined;
  if (!row) throw new FleetError('not_found', 404);
  return row;
}

function messageDto(r: { id: string; role: MessageRole; event: string; text: string; status: string; source: string; created_at: string; delivered_at: string | null }): MessageDto {
  return {
    id: r.id,
    role: r.role,
    event: r.event,
    text: r.text,
    status: r.status === 'pending' || r.status === 'delivered' || r.status === 'cancelled' ? r.status : '',
    source: r.source,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
  };
}

export async function listMessages(actor: FleetActor, sessionId: string, opts: { limit?: number } = {}): Promise<MessageDto[]> {
  await ownSession(actor, sessionId);
  const rows = (await db()
    .prepare("SELECT * FROM fleet_messages WHERE session_id = ? AND workspace_id = ? AND person_id = ? AND role != 'link' ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(sessionId, actor.ws, actor.person, opts.limit ?? 300)) as Parameters<typeof messageDto>[0][];
  return rows.reverse().map(messageDto);
}

/** Abrir la conversación la marca leída. */
export async function markRead(actor: FleetActor, sessionId: string): Promise<void> {
  const res = await db().prepare('UPDATE fleet_sessions SET unread = 0 WHERE id = ? AND workspace_id = ? AND person_id = ? AND unread > 0').run(sessionId, actor.ws, actor.person);
  if (res.changes) await pushFeed(actor.ws, actor.person, 'session', sessionId);
}

// ---------- Escritura de la persona ----------

/** Deja una respuesta en cola para el agente: la entrega su próximo Stop (o el próximo prompt). */
export async function queueReply(
  owner: Pick<FleetActor, 'ws' | 'person'>,
  sessionId: string,
  text: string,
  source: ReplySource = 'web',
  externalRef = '',
): Promise<MessageDto> {
  const row = (await db().prepare('SELECT * FROM fleet_sessions WHERE id = ? AND workspace_id = ? AND person_id = ?').get(sessionId, owner.ws, owner.person)) as SessionRow | undefined;
  if (!row) throw new FleetError('not_found', 404);
  const clean = redactSecrets(clip(text.trim(), LIMITS.reply));
  if (!clean) throw new FleetError('empty_message', 400);
  const pending = (await db().prepare("SELECT COUNT(*) AS n FROM fleet_messages WHERE session_id = ? AND role = 'reply' AND status = 'pending'").get(sessionId)) as { n: number };
  if (Number(pending.n) >= MAX_PENDING) throw new FleetError('too_many_pending', 429);
  const id = randomUUID();
  const ts = nowIso();
  await db()
    .prepare("INSERT INTO fleet_messages (id, session_id, workspace_id, person_id, role, event, text, status, source, external_ref, created_at) VALUES (?, ?, ?, ?, 'reply', '', ?, 'pending', ?, ?, ?)")
    .run(id, sessionId, owner.ws, owner.person, clean, source, externalRef, ts);
  await db().prepare('UPDATE fleet_sessions SET unread = 0, updated_at = ? WHERE id = ?').run(ts, sessionId);
  await pushFeed(owner.ws, owner.person, 'message', sessionId);
  await pushFeed(owner.ws, owner.person, 'session', sessionId);
  return messageDto({ id, role: 'reply', event: '', text: clean, status: 'pending', source, created_at: ts, delivered_at: null });
}

/** Saca de la cola una respuesta que todavía no se entregó. */
export async function cancelReply(actor: FleetActor, sessionId: string, messageId: string): Promise<void> {
  await ownSession(actor, sessionId);
  const res = await db()
    .prepare("UPDATE fleet_messages SET status = 'cancelled' WHERE id = ? AND session_id = ? AND role = 'reply' AND status = 'pending'")
    .run(messageId, sessionId);
  if (!res.changes) throw new FleetError('not_pending', 409);
  await pushFeed(actor.ws, actor.person, 'message', sessionId);
  await pushFeed(actor.ws, actor.person, 'session', sessionId);
}

export async function renameSession(actor: FleetActor, sessionId: string, title: string): Promise<void> {
  await ownSession(actor, sessionId);
  await db().prepare('UPDATE fleet_sessions SET custom_title = ?, updated_at = ? WHERE id = ?').run(oneLine(title, LIMITS.title), nowIso(), sessionId);
  await pushFeed(actor.ws, actor.person, 'session', sessionId);
}

export async function archiveSession(actor: FleetActor, sessionId: string, archived: boolean): Promise<void> {
  await ownSession(actor, sessionId);
  await db().prepare('UPDATE fleet_sessions SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, nowIso(), sessionId);
  await pushFeed(actor.ws, actor.person, 'session', sessionId);
}

export async function deleteSession(actor: FleetActor, sessionId: string): Promise<void> {
  await ownSession(actor, sessionId);
  await db().prepare('DELETE FROM fleet_messages WHERE session_id = ?').run(sessionId);
  await db().prepare('DELETE FROM fleet_sessions WHERE id = ?').run(sessionId);
  await pushFeed(actor.ws, actor.person, 'session', sessionId);
}

/** Cmd+K: sesiones por título, proyecto o rama. */
export async function searchSessions(actor: FleetActor, q: string): Promise<Array<{ id: string; label: string; meta: string; href: string }>> {
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = (await db()
    .prepare(
      `SELECT id, title, custom_title, project, branch, session_key FROM fleet_sessions WHERE workspace_id = ? AND person_id = ?
         AND (custom_title LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR project LIKE ? ESCAPE '\\' OR branch LIKE ? ESCAPE '\\')
       ORDER BY last_event_at DESC LIMIT 8`,
    )
    .all(actor.ws, actor.person, like, like, like, like)) as Array<Pick<SessionRow, 'id' | 'title' | 'custom_title' | 'project' | 'branch' | 'session_key'>>;
  return rows.map((r) => ({
    id: r.id,
    label: r.custom_title || r.title || r.project || r.session_key.slice(0, 8),
    meta: [r.project, r.branch].filter(Boolean).join(' · '),
    href: `/app/fleet/chats/${r.id}`,
  }));
}

/**
 * Sesiones "trabajando" sin eventos hace más de 2 horas (la terminal se cerró sin Stop): quedan como inactivas
 * (cron). Las que te esperan siguen esperando.
 */
export async function settleStaleSessions(now = Date.now()): Promise<number> {
  const res = await db()
    .prepare("UPDATE fleet_sessions SET status = 'idle', updated_at = ? WHERE status = 'working' AND last_event_at < ?")
    .run(new Date(now).toISOString(), new Date(now - 2 * 3600_000).toISOString());
  return res.changes;
}

export type { SessionStatus };
