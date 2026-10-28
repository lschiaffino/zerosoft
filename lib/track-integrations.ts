/**
 * Track — base común de las integraciones (Slack, Sentry, Zendesk, Intercom):
 *
 * - track_integrations: una fila por proveedor y workspace con el secreto y el
 *   token cifrados (lib/secret-box) y la config; nunca se devuelven.
 * - track_external_refs: vínculos de un issue con algo de afuera (hilo de
 *   Slack, issue de Sentry, issue de GitHub, ticket de Zendesk/Intercom).
 * - track_integration_outbox: llamadas salientes con reintentos. Se intentan
 *   al toque y el cron de cada minuto retoma las pendientes, con claim por
 *   fila (locked_until) para no mandar nada dos veces.
 * - track_integration_events: log corto que se ve en Ajustes (qué entró, qué
 *   salió, si falló). Nunca guarda tokens.
 */
import { ownerSpaceSql } from './workspace';
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import { open, seal } from './secret-box';

export type IntegrationProvider = 'slack' | 'sentry' | 'zendesk' | 'intercom' | 'github' | 'figma';

// ---------- Config por workspace ----------

export interface IntegrationRow {
  id: string;
  workspace_id: string;
  provider: IntegrationProvider;
  secret: string | null;
  token: string | null;
  config: string;
  last_event_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface IntegrationView {
  id: string;
  provider: IntegrationProvider;
  config: Record<string, unknown>;
  hasToken: boolean;
  lastEventAt: string | null;
  createdAt: string;
}

function parseObj(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function getIntegrationRow(workspaceId: string, provider: IntegrationProvider): Promise<IntegrationRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM track_integrations WHERE workspace_id = ? AND provider = ?')
    .get(workspaceId, provider)) as IntegrationRow | undefined;
}

export async function getIntegrationById(id: string): Promise<IntegrationRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_integrations WHERE id = ?').get(id)) as IntegrationRow | undefined;
}

export function integrationView(row: IntegrationRow): IntegrationView {
  return {
    id: row.id,
    provider: row.provider,
    config: parseObj(row.config),
    hasToken: Boolean(row.token),
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
  };
}

export function integrationConfig(row: IntegrationRow): Record<string, unknown> {
  return parseObj(row.config);
}

export function integrationSecret(row: IntegrationRow): string | null {
  return row.secret ? open(row.secret) : null;
}

export function integrationToken(row: IntegrationRow): string | null {
  return row.token ? open(row.token) : null;
}

/**
 * Crea o actualiza la integración. `secret` y `token` en undefined no se
 * tocan; en null se borran. La config se reemplaza entera.
 */
export async function saveIntegration(
  workspaceId: string,
  provider: IntegrationProvider,
  input: { config: Record<string, unknown>; secret?: string | null; token?: string | null; createdBy: string },
): Promise<IntegrationRow> {
  const existing = await getIntegrationRow(workspaceId, provider);
  const db = getDb();
  const sealOrNull = (v: string | null) => (v ? seal(v) : null);
  if (existing) {
    await db
      .prepare(
        `UPDATE track_integrations SET config = ?,
           secret = CASE WHEN ? THEN ? ELSE secret END,
           token = CASE WHEN ? THEN ? ELSE token END
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(input.config),
        input.secret !== undefined ? 1 : 0,
        input.secret !== undefined ? sealOrNull(input.secret) : null,
        input.token !== undefined ? 1 : 0,
        input.token !== undefined ? sealOrNull(input.token) : null,
        existing.id,
      );
  } else {
    await db
      .prepare(
        'INSERT INTO track_integrations (id, workspace_id, provider, secret, token, config, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        crypto.randomUUID().replace(/-/g, ''),
        workspaceId,
        provider,
        sealOrNull(input.secret ?? null),
        sealOrNull(input.token ?? null),
        JSON.stringify(input.config),
        input.createdBy,
      );
  }
  return (await getIntegrationRow(workspaceId, provider)) as IntegrationRow;
}

export async function deleteIntegration(workspaceId: string, provider: IntegrationProvider): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM track_integrations WHERE workspace_id = ? AND provider = ?')
    .run(workspaceId, provider);
  return res.changes > 0;
}

export async function touchIntegration(id: string): Promise<void> {
  await getDb().prepare("UPDATE track_integrations SET last_event_at = datetime('now') WHERE id = ?").run(id);
}

// ---------- Log ----------

export interface IntegrationEvent {
  id: string;
  provider: string;
  direction: 'in' | 'out';
  kind: string;
  summary: string;
  ok: boolean;
  createdAt: string;
}

export async function logIntegrationEvent(
  workspaceId: string,
  provider: IntegrationProvider,
  direction: 'in' | 'out',
  kind: string,
  summary: string,
  ok = true,
): Promise<void> {
  try {
    await getDb()
      .prepare(
        'INSERT INTO track_integration_events (id, workspace_id, provider, direction, kind, summary, ok) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(crypto.randomUUID(), workspaceId, provider, direction, kind.slice(0, 60), summary.slice(0, 500), ok ? 1 : 0);
  } catch {
    // El log es informativo.
  }
}

export async function listIntegrationEvents(workspaceId: string, provider: IntegrationProvider, limit = 20): Promise<IntegrationEvent[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, provider, direction, kind, summary, ok, created_at FROM track_integration_events
       WHERE workspace_id = ? AND provider = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(workspaceId, provider, limit)) as Array<{ id: string; provider: string; direction: 'in' | 'out'; kind: string; summary: string; ok: number; created_at: string }>;
  return rows.map((r) => ({ id: r.id, provider: r.provider, direction: r.direction, kind: r.kind, summary: r.summary, ok: r.ok === 1, createdAt: r.created_at }));
}

// ---------- Referencias externas ----------

export interface ExternalRef {
  id: string;
  issue_id: string;
  workspace_id: string;
  provider: string;
  external_id: string;
  url: string | null;
  title: string;
  state: string | null;
  meta: string;
  created_at: string;
  updated_at: string;
}

export interface ExternalRefView {
  id: string;
  provider: string;
  externalId: string;
  url: string | null;
  title: string;
  state: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export function refView(r: ExternalRef): ExternalRefView {
  return { id: r.id, provider: r.provider, externalId: r.external_id, url: r.url, title: r.title, state: r.state, meta: parseObj(r.meta), createdAt: r.created_at };
}

export async function upsertExternalRef(input: {
  issueId: string;
  workspaceId: string;
  provider: string;
  externalId: string;
  url?: string | null;
  title?: string;
  state?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO track_external_refs (id, issue_id, workspace_id, provider, external_id, url, title, state, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, provider, external_id) DO UPDATE SET
         issue_id = excluded.issue_id,
         url = COALESCE(excluded.url, track_external_refs.url),
         title = CASE WHEN excluded.title != '' THEN excluded.title ELSE track_external_refs.title END,
         state = COALESCE(excluded.state, track_external_refs.state),
         meta = excluded.meta,
         updated_at = datetime('now')`,
    )
    .run(
      crypto.randomUUID(),
      input.issueId,
      input.workspaceId,
      input.provider,
      input.externalId,
      input.url ?? null,
      (input.title ?? '').slice(0, 300),
      input.state ?? null,
      JSON.stringify(input.meta ?? {}),
    );
}

export async function findExternalRef(workspaceId: string, provider: string, externalId: string): Promise<ExternalRef | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM track_external_refs WHERE workspace_id = ? AND provider = ? AND external_id = ?')
    .get(workspaceId, provider, externalId)) as ExternalRef | undefined;
}

export async function listIssueRefs(issueId: string, provider?: string): Promise<ExternalRef[]> {
  return (await getDb()
    .prepare(
      `SELECT * FROM track_external_refs WHERE issue_id = ? ${provider ? 'AND provider = ?' : ''} ORDER BY created_at ASC LIMIT 50`,
    )
    .all(...(provider ? [issueId, provider] : [issueId]))) as ExternalRef[];
}

export async function deleteExternalRef(issueId: string, refId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_external_refs WHERE id = ? AND issue_id = ?').run(refId, issueId);
  return res.changes > 0;
}

export async function setExternalRefState(id: string, state: string): Promise<void> {
  await getDb().prepare("UPDATE track_external_refs SET state = ?, updated_at = datetime('now') WHERE id = ?").run(state, id);
}

// ---------- Outbox ----------

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];

export class IntegrationSkip extends Error {}

type OutboxHandler = (workspaceId: string, kind: string, payload: Record<string, unknown>) => Promise<void>;

async function handlerFor(provider: string): Promise<OutboxHandler | null> {
  if (provider === 'slack') return (await import('./track-slack')).runSlackOutbox;
  if (provider === 'sentry' || provider === 'zendesk' || provider === 'intercom') {
    return (await import('./track-support')).runSupportOutbox;
  }
  return null;
}

export async function enqueueOutbox(
  workspaceId: string,
  provider: IntegrationProvider,
  kind: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO track_integration_outbox (id, workspace_id, provider, kind, payload) VALUES (?, ?, ?, ?, ?)')
    .run(id, workspaceId, provider, kind, JSON.stringify(payload));
  return id;
}

async function claimOutbox(id: string): Promise<boolean> {
  const now = new Date();
  const res = await getDb()
    .prepare(
      `UPDATE track_integration_outbox SET locked_until = ?
       WHERE id = ? AND status = 'pending' AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(new Date(now.getTime() + 60_000).toISOString(), id, now.toISOString());
  return res.changes > 0;
}

/** Intenta una fila de la cola (si la puede reclamar). Nunca lanza. */
export async function runOutboxItem(id: string): Promise<void> {
  try {
    if (!(await claimOutbox(id))) return;
    const db = getDb();
    const row = (await db.prepare('SELECT * FROM track_integration_outbox WHERE id = ?').get(id)) as
      | { id: string; workspace_id: string; provider: string; kind: string; payload: string; attempts: number }
      | undefined;
    if (!row) return;
    const attempts = row.attempts + 1;
    try {
      const handler = await handlerFor(row.provider);
      if (!handler) throw new IntegrationSkip('no_handler');
      await handler(row.workspace_id, row.kind, parseObj(row.payload));
      await db
        .prepare("UPDATE track_integration_outbox SET status = 'sent', attempts = ?, last_error = NULL, locked_until = NULL WHERE id = ?")
        .run(attempts, id);
    } catch (err) {
      const skip = err instanceof IntegrationSkip;
      const delay = skip ? undefined : BACKOFF_MS[attempts - 1];
      const message = err instanceof Error ? err.message.slice(0, 200) : 'error';
      await db
        .prepare(
          'UPDATE track_integration_outbox SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, locked_until = NULL WHERE id = ?',
        )
        .run(
          delay === undefined ? (skip ? 'skipped' : 'failed') : 'pending',
          attempts,
          message,
          delay === undefined ? null : new Date(Date.now() + delay).toISOString(),
          id,
        );
      if (!skip) {
        await logIntegrationEvent(row.workspace_id, row.provider as IntegrationProvider, 'out', row.kind, message, false);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[track-integrations] outbox failed', err);
  }
}

/** Pendientes vencidas (las nuevas se intentan al encolar; si no se pudo, esperan 1 minuto). */
export async function processOutbox(opts: { limit?: number } = {}): Promise<number> {
  const due = (await getDb()
    .prepare(
      `SELECT id FROM track_integration_outbox
       WHERE status = 'pending'
         AND ((next_attempt_at IS NOT NULL AND next_attempt_at <= ?) OR (next_attempt_at IS NULL AND created_at <= datetime('now', '-1 minutes')))
       ORDER BY created_at LIMIT ?`,
    )
    .all(new Date().toISOString(), opts.limit ?? 100)) as Array<{ id: string }>;
  for (const d of due) await runOutboxItem(d.id);
  return due.length;
}

// ---------- OAuth state y personas ----------

function stateKey(): string {
  return process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'zerosoft-dev-state-key';
}

/** `state` firmado para un OAuth (workspace + persona + vence en 15 minutos). */
export function signOAuthState(workspaceId: string, personId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ w: workspaceId, p: personId, e: now + 15 * 60_000 })).toString('base64url');
  const mac = createHmac('sha256', stateKey()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyOAuthState(state: string | null | undefined, now = Date.now()): { workspaceId: string; personId: string } | null {
  if (!state || !state.includes('.')) return null;
  const [body, mac] = state.split('.');
  const expected = createHmac('sha256', stateKey()).update(body).digest('base64url');
  if (!mac || mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { w: string; p: string; e: number };
    if (typeof v.w !== 'string' || typeof v.p !== 'string' || typeof v.e !== 'number' || v.e < now) return null;
    return { workspaceId: v.w, personId: v.p };
  } catch {
    return null;
  }
}

/** Persona del workspace (dueño o miembro del team) con ese email, o null. */
export async function workspacePersonByEmail(
  workspaceId: string,
  email: string | null | undefined,
): Promise<{ id: string; name: string | null; email: string } | null> {
  if (!email) return null;
  const row = (await getDb()
    .prepare(
      `SELECT u.id, u.name, u.email FROM users u
       WHERE lower(u.email) = lower(?) AND (
         ${ownerSpaceSql('?', 'u.id')} OR EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = ? AND m.user_id = u.id AND m.role != 'guest')
       ) LIMIT 1`,
    )
    .get(email.trim(), workspaceId, workspaceId, workspaceId)) as { id: string; name: string | null; email: string } | undefined;
  return row ?? null;
}

/** Dueño técnico del workspace (owner del team, o el usuario si es personal). */
export async function workspaceOwnerId(workspaceId: string): Promise<string> {
  const team = (await getDb().prepare('SELECT owner_id FROM teams WHERE id = ?').get(workspaceId)) as { owner_id: string } | undefined;
  return team?.owner_id ?? workspaceId;
}

/** Equipo (null si el workspace es personal) para las funciones que piden teamId. */
export async function workspaceTeamId(workspaceId: string): Promise<string | null> {
  const team = await getDb().prepare('SELECT id FROM teams WHERE id = ?').get(workspaceId);
  return team ? workspaceId : null;
}
