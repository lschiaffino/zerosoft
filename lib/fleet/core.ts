/**
 * Fleet: cuentas conectadas (GitHub y Vercel), su sincronización, lo sincronizado (PRs, corridas, releases,
 * proyectos y deploys), el feed del tiempo real y los ajustes. Todo se lee y escribe con el actor (workspace +
 * persona): nada de otra persona ni de otro workspace. Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db';
import { open, seal } from '../secret-box';
import { githubRepos, githubSnapshot, githubWhoAmI, isRepoName } from './github';
import { vercelSnapshot, vercelWhoAmI } from './vercel';
import {
  DEFAULT_PREFS,
  FleetError,
  LIMITS,
  clip,
  type ChecksState,
  type ConnectionDto,
  type ConnectionKind,
  type DeployDto,
  type DeployState,
  type FleetPrefs,
  type PullDto,
  type ReleaseDto,
  type RunDto,
} from './types';

export interface FleetActor {
  ws: string;
  person: string;
  email: string;
  name: string;
}

export function nowIso(now = new Date()): string {
  return now.toISOString();
}

const db = () => getDb();

/** Tope de cuentas por persona y de repos por cuenta de GitHub. */
export const MAX_CONNECTIONS = 20;
export const MAX_REPOS = 15;
/** Cada cuánto el cron vuelve a sincronizar una cuenta. */
export const SYNC_EVERY_MS = 5 * 60_000;
const CLAIM_MS = 3 * 60_000;

// ---------- Feed (tiempo real) ----------

export type FeedKind = 'session' | 'message' | 'items' | 'connections';

export async function pushFeed(ws: string, person: string, kind: FeedKind, ref = ''): Promise<void> {
  await db().prepare('INSERT INTO fleet_feed (workspace_id, person_id, kind, ref, created_at) VALUES (?, ?, ?, ?, ?)').run(ws, person, kind, ref, nowIso());
}

export interface FeedEvent {
  id: number;
  kind: FeedKind;
  ref: string;
}

/** Hueco más grande que esto: el cliente rehace el estado (reset). */
const FEED_PAGE = 200;

export async function feedSince(actor: FleetActor, cursor: number): Promise<{ events: FeedEvent[]; cursor: number; reset?: boolean }> {
  if (cursor <= 0) return { events: [], cursor: await feedCursor(actor) };
  const rows = (await db()
    .prepare('SELECT id, kind, ref FROM fleet_feed WHERE workspace_id = ? AND person_id = ? AND id > ? ORDER BY id LIMIT ?')
    .all(actor.ws, actor.person, cursor, FEED_PAGE + 1)) as Array<{ id: number; kind: FeedKind; ref: string }>;
  if (rows.length > FEED_PAGE) {
    // Hueco grande: un evento que hace releer todo (el stream manda lotes; el cliente refresca con cualquiera).
    const c = await feedCursor(actor);
    return { events: [{ id: c, kind: 'connections', ref: '' }], cursor: c, reset: true };
  }
  const events = rows.map((r) => ({ id: Number(r.id), kind: r.kind, ref: r.ref }));
  return { events, cursor: events.length ? events[events.length - 1].id : cursor };
}

export async function feedCursor(actor: FleetActor): Promise<number> {
  const row = (await db().prepare('SELECT MAX(id) AS id FROM fleet_feed WHERE workspace_id = ? AND person_id = ?').get(actor.ws, actor.person)) as { id: number | null } | undefined;
  return Number(row?.id ?? 0) || 0;
}

/** Borra el feed de más de un día (cron). */
export async function pruneFeed(now = Date.now()): Promise<number> {
  const res = await db().prepare('DELETE FROM fleet_feed WHERE created_at < ?').run(new Date(now - 24 * 3600_000).toISOString());
  return res.changes;
}

// ---------- Cuentas ----------

interface ConnectionRow {
  id: string;
  workspace_id: string;
  person_id: string;
  kind: ConnectionKind;
  label: string;
  account: string;
  token: string;
  token_hint: string;
  config: string;
  status: 'ok' | 'error';
  error: string;
  last_sync_at: string | null;
  sync_claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ConnectionConfig {
  repos?: string[];
  projects?: string[];
  teamId?: string;
}

function config(row: Pick<ConnectionRow, 'config'>): ConnectionConfig {
  try {
    const c = JSON.parse(row.config || '{}') as ConnectionConfig;
    return c && typeof c === 'object' ? c : {};
  } catch {
    return {};
  }
}

function connectionDto(r: ConnectionRow): ConnectionDto {
  const c = config(r);
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    account: r.account,
    tokenHint: r.token_hint,
    status: r.status === 'error' ? 'error' : 'ok',
    error: r.error,
    lastSyncAt: r.last_sync_at,
    selected: r.kind === 'github' ? (c.repos ?? []) : (c.projects ?? []),
    teamId: c.teamId ?? '',
    createdAt: r.created_at,
  };
}

export async function listConnections(actor: FleetActor): Promise<ConnectionDto[]> {
  const rows = (await db()
    .prepare('SELECT * FROM fleet_connections WHERE workspace_id = ? AND person_id = ? ORDER BY kind, created_at')
    .all(actor.ws, actor.person)) as ConnectionRow[];
  return rows.map(connectionDto);
}

async function getConnectionRow(actor: FleetActor, id: string): Promise<ConnectionRow> {
  const row = (await db().prepare('SELECT * FROM fleet_connections WHERE id = ? AND workspace_id = ? AND person_id = ?').get(id, actor.ws, actor.person)) as ConnectionRow | undefined;
  if (!row) throw new FleetError('not_found', 404);
  return row;
}

function hintOf(token: string): string {
  return token.length > 8 ? token.slice(-4) : '';
}

function cleanToken(raw: unknown): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t || t.length > 400 || /\s/.test(t)) throw new FleetError('invalid_token', 400);
  return t;
}

/**
 * Conecta una cuenta: valida el token contra la API (sin guardar nada si falla) y lo guarda sellado. GitHub elige
 * por defecto los 5 repos con push más reciente; Vercel, todos los proyectos del equipo elegido.
 */
export async function createConnection(
  actor: FleetActor,
  input: { kind: ConnectionKind; token: string; label?: string; teamId?: string; repos?: string[] },
): Promise<{ connection: ConnectionDto; teams?: Array<{ id: string; slug: string; name: string }> }> {
  const count = (await db().prepare('SELECT COUNT(*) AS n FROM fleet_connections WHERE workspace_id = ? AND person_id = ?').get(actor.ws, actor.person)) as { n: number };
  if (Number(count.n) >= MAX_CONNECTIONS) throw new FleetError('too_many_connections', 400);
  const token = cleanToken(input.token);
  let account = '';
  let cfg: ConnectionConfig = {};
  let teams: Array<{ id: string; slug: string; name: string }> | undefined;
  if (input.kind === 'github') {
    account = (await githubWhoAmI(token)).login;
    const repos = (input.repos ?? []).filter(isRepoName).slice(0, MAX_REPOS);
    cfg.repos = repos.length ? repos : (await githubRepos(token)).slice(0, 5).map((r) => r.fullName);
  } else {
    const me = await vercelWhoAmI(token);
    teams = me.teams;
    const teamId = typeof input.teamId === 'string' ? input.teamId.trim() : '';
    if (teamId && !me.teams.some((t) => t.id === teamId)) throw new FleetError('team_not_found', 400);
    const team = me.teams.find((t) => t.id === teamId);
    account = team ? team.slug || team.name : me.username;
    cfg = { teamId, projects: [] };
  }
  const id = randomUUID();
  const ts = nowIso();
  const label = clip((input.label ?? '').trim(), LIMITS.label) || account;
  await db()
    .prepare(
      `INSERT INTO fleet_connections (id, workspace_id, person_id, kind, label, account, token, token_hint, config, status, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', '', ?, ?)`,
    )
    .run(id, actor.ws, actor.person, input.kind, label, account, seal(token), hintOf(token), JSON.stringify(cfg), ts, ts);
  await pushFeed(actor.ws, actor.person, 'connections', id);
  return { connection: connectionDto(await getConnectionRow(actor, id)), teams };
}

export async function updateConnection(actor: FleetActor, id: string, input: { label?: string; selected?: string[] }): Promise<ConnectionDto> {
  const row = await getConnectionRow(actor, id);
  const cfg = config(row);
  if (input.selected) {
    if (row.kind === 'github') {
      const repos = [...new Set(input.selected.filter(isRepoName))].slice(0, MAX_REPOS);
      cfg.repos = repos;
    } else {
      cfg.projects = [...new Set(input.selected.filter((p) => typeof p === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(p)))].slice(0, 50);
    }
  }
  const label = input.label !== undefined ? clip(input.label.trim(), LIMITS.label) || row.account : row.label;
  await db()
    .prepare('UPDATE fleet_connections SET label = ?, config = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .run(label, JSON.stringify(cfg), nowIso(), id, actor.ws, actor.person);
  if (input.selected) {
    // Lo de repos o proyectos que se sacaron deja de verse ya, sin esperar la próxima sincronización.
    if (row.kind === 'github') {
      const keep = cfg.repos ?? [];
      await db()
        .prepare(`DELETE FROM fleet_items WHERE connection_id = ? AND repo NOT IN (${keep.map(() => '?').join(',') || "''"})`)
        .run(id, ...keep);
    }
  }
  await pushFeed(actor.ws, actor.person, 'connections', id);
  return connectionDto(await getConnectionRow(actor, id));
}

export async function deleteConnection(actor: FleetActor, id: string): Promise<void> {
  await getConnectionRow(actor, id);
  await db().prepare('DELETE FROM fleet_items WHERE connection_id = ? AND workspace_id = ? AND person_id = ?').run(id, actor.ws, actor.person);
  await db().prepare('DELETE FROM fleet_connections WHERE id = ? AND workspace_id = ? AND person_id = ?').run(id, actor.ws, actor.person);
  await pushFeed(actor.ws, actor.person, 'connections', id);
}

/** Lo que se puede elegir en una cuenta: repos que ve el token (GitHub) o proyectos del equipo (Vercel). */
export async function connectionOptions(actor: FleetActor, id: string): Promise<Array<{ id: string; name: string; private?: boolean }>> {
  const row = await getConnectionRow(actor, id);
  const token = open(row.token);
  if (row.kind === 'github') return (await githubRepos(token)).map((r) => ({ id: r.fullName, name: r.fullName, private: r.private }));
  const snap = await vercelSnapshot(token, config(row).teamId ?? '', []);
  return snap.projects.map((p) => ({ id: p.externalId, name: p.name }));
}

// ---------- Sincronización ----------

interface ItemInput {
  kind: 'pr' | 'run' | 'release' | 'project' | 'deploy';
  externalId: string;
  repo: string;
  title: string;
  url: string;
  state: string;
  author: string;
  branch: string;
  sha: string;
  data: Record<string, unknown>;
  occurredAt: string | null;
}

async function upsertItems(row: ConnectionRow, items: ItemInput[], ts: string): Promise<void> {
  for (const it of items) {
    await db()
      .prepare(
        `INSERT INTO fleet_items (id, workspace_id, person_id, connection_id, kind, external_id, repo, title, url, state, author, branch, sha, data, occurred_at, seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, kind, external_id) DO UPDATE SET
           repo = excluded.repo, title = excluded.title, url = excluded.url, state = excluded.state, author = excluded.author,
           branch = excluded.branch, sha = excluded.sha, data = excluded.data, occurred_at = excluded.occurred_at, seen_at = excluded.seen_at`,
      )
      .run(randomUUID(), row.workspace_id, row.person_id, row.id, it.kind, it.externalId, it.repo, it.title, it.url, it.state, it.author, it.branch, it.sha, JSON.stringify(it.data), it.occurredAt, ts);
  }
}

async function syncGithub(row: ConnectionRow, token: string, ts: string): Promise<string[]> {
  const repos = (config(row).repos ?? []).filter(isRepoName).slice(0, MAX_REPOS);
  const errors: string[] = [];
  for (const repo of repos) {
    try {
      const snap = await githubSnapshot(token, repo);
      await upsertItems(
        row,
        [
          ...snap.pulls.map<ItemInput>((p) => ({
            kind: 'pr',
            externalId: p.externalId,
            repo,
            title: p.title,
            url: p.url,
            state: 'open',
            author: p.author,
            branch: p.branch,
            sha: p.sha,
            data: { number: p.number, draft: p.draft, autoMerge: p.autoMerge, mergeable: p.mergeable, mergeState: p.mergeState, checks: p.checks, createdAt: p.createdAt },
            occurredAt: p.updatedAt,
          })),
          ...snap.runs.map<ItemInput>((r) => ({
            kind: 'run',
            externalId: r.externalId,
            repo,
            title: r.name,
            url: r.url,
            state: r.conclusion || r.status,
            author: r.actor,
            branch: r.branch,
            sha: r.sha,
            data: { status: r.status, conclusion: r.conclusion, event: r.event },
            occurredAt: r.at,
          })),
          ...snap.releases.map<ItemInput>((r) => ({
            kind: 'release',
            externalId: r.externalId,
            repo,
            title: r.name,
            url: r.url,
            state: r.draft ? 'draft' : r.prerelease ? 'prerelease' : 'published',
            author: r.author,
            branch: '',
            sha: '',
            data: { tag: r.tag, draft: r.draft, prerelease: r.prerelease },
            occurredAt: r.at,
          })),
        ],
        ts,
      );
      // Lo de este repo que ya no vino (PRs cerrados, corridas viejas) se va.
      await db().prepare('DELETE FROM fleet_items WHERE connection_id = ? AND repo = ? AND seen_at < ?').run(row.id, repo, ts);
    } catch (err) {
      if (err instanceof FleetError && /unauthorized/.test(err.code)) throw err;
      errors.push(`${repo}: ${err instanceof FleetError ? err.code : 'github_error'}`);
    }
  }
  // Repos que se sacaron de la lista.
  await db()
    .prepare(`DELETE FROM fleet_items WHERE connection_id = ? AND repo NOT IN (${repos.map(() => '?').join(',') || "''"})`)
    .run(row.id, ...repos);
  return errors;
}

async function syncVercel(row: ConnectionRow, token: string, ts: string): Promise<string[]> {
  const cfg = config(row);
  const snap = await vercelSnapshot(token, cfg.teamId ?? '', cfg.projects ?? []);
  const prodIds = new Set(snap.projects.map((p) => p.productionDeploymentId).filter(Boolean));
  await upsertItems(
    row,
    [
      ...snap.projects.map<ItemInput>((p) => ({
        kind: 'project',
        externalId: p.externalId,
        repo: p.name,
        title: p.name,
        url: p.url,
        state: '',
        author: '',
        branch: '',
        sha: '',
        data: { productionDeploymentId: p.productionDeploymentId, framework: p.framework },
        occurredAt: p.updatedAt,
      })),
      ...snap.deployments.map<ItemInput>((d) => ({
        kind: 'deploy',
        externalId: d.externalId,
        repo: d.project,
        title: d.commitMessage,
        url: d.url,
        state: d.state,
        author: d.creator,
        branch: d.branch,
        sha: d.sha,
        data: { projectId: d.projectId, inspectorUrl: d.inspectorUrl, target: d.target, prNumber: d.prNumber, readyAt: d.readyAt, serving: prodIds.has(d.externalId) },
        occurredAt: d.at,
      })),
    ],
    ts,
  );
  await db().prepare('DELETE FROM fleet_items WHERE connection_id = ? AND seen_at < ?').run(row.id, ts);
  return [];
}

/** Sincroniza una cuenta ya reclamada. Guarda el estado (ok o el error) y avisa por el feed. */
async function syncRow(row: ConnectionRow): Promise<{ ok: boolean; error?: string }> {
  const ts = nowIso();
  let error = '';
  try {
    const token = open(row.token);
    const errors = row.kind === 'github' ? await syncGithub(row, token, ts) : await syncVercel(row, token, ts);
    error = errors.join('; ').slice(0, 500);
  } catch (err) {
    error = err instanceof FleetError ? err.code : 'sync_failed';
    if (!(err instanceof FleetError)) console.error('[fleet] sync', row.kind, err instanceof Error ? err.message : 'error');
  }
  await db()
    .prepare('UPDATE fleet_connections SET status = ?, error = ?, last_sync_at = ?, sync_claimed_at = NULL, updated_at = ? WHERE id = ?')
    .run(error ? 'error' : 'ok', error, ts, ts, row.id);
  await pushFeed(row.workspace_id, row.person_id, 'items', row.id);
  return error ? { ok: false, error } : { ok: true };
}

/** Reclama la fila (compare-and-set de sync_claimed_at): dos corridas no sincronizan lo mismo a la vez. */
async function claim(id: string, now: Date): Promise<boolean> {
  const res = await db()
    .prepare('UPDATE fleet_connections SET sync_claimed_at = ? WHERE id = ? AND (sync_claimed_at IS NULL OR sync_claimed_at < ?)')
    .run(nowIso(now), id, new Date(now.getTime() - CLAIM_MS).toISOString());
  return res.changes === 1;
}

/** "Actualizar" de la persona: sincroniza ya todas sus cuentas (o una). */
export async function syncNow(actor: FleetActor, id?: string): Promise<{ synced: number; errors: number }> {
  const rows = (await db()
    .prepare(`SELECT * FROM fleet_connections WHERE workspace_id = ? AND person_id = ?${id ? ' AND id = ?' : ''}`)
    .all(...(id ? [actor.ws, actor.person, id] : [actor.ws, actor.person]))) as ConnectionRow[];
  if (id && !rows.length) throw new FleetError('not_found', 404);
  let synced = 0;
  let errors = 0;
  await Promise.all(
    rows.map(async (row) => {
      if (!(await claim(row.id, new Date()))) return;
      const r = await syncRow(row);
      synced++;
      if (!r.ok) errors++;
    }),
  );
  return { synced, errors };
}

/** Cron: las cuentas que no se sincronizan hace más de SYNC_EVERY_MS, con presupuesto de tiempo. */
export async function syncDueConnections(opts: { limit?: number; budgetMs?: number; now?: Date } = {}): Promise<{ synced: number }> {
  const now = opts.now ?? new Date();
  const start = Date.now();
  const rows = (await db()
    .prepare(
      `SELECT * FROM fleet_connections WHERE (last_sync_at IS NULL OR last_sync_at < ?) AND (sync_claimed_at IS NULL OR sync_claimed_at < ?)
       ORDER BY last_sync_at IS NOT NULL, last_sync_at LIMIT ?`,
    )
    .all(new Date(now.getTime() - SYNC_EVERY_MS).toISOString(), new Date(now.getTime() - CLAIM_MS).toISOString(), opts.limit ?? 20)) as ConnectionRow[];
  let synced = 0;
  for (const row of rows) {
    if (Date.now() - start > (opts.budgetMs ?? 40_000)) break;
    if (!(await claim(row.id, now))) continue;
    await syncRow(row);
    synced++;
  }
  return { synced };
}

// ---------- Lo sincronizado ----------

interface ItemRow {
  id: string;
  connection_id: string;
  kind: string;
  external_id: string;
  repo: string;
  title: string;
  url: string;
  state: string;
  author: string;
  branch: string;
  sha: string;
  data: string;
  occurred_at: string | null;
}

function data(r: Pick<ItemRow, 'data'>): Record<string, unknown> {
  try {
    return JSON.parse(r.data || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function pullDto(r: ItemRow): PullDto {
  const d = data(r);
  return {
    id: r.id,
    connectionId: r.connection_id,
    repo: r.repo,
    number: Number(d.number) || 0,
    title: r.title,
    url: r.url,
    author: r.author,
    branch: r.branch,
    sha: r.sha,
    draft: d.draft === true,
    autoMerge: d.autoMerge === true,
    mergeable: typeof d.mergeable === 'string' ? d.mergeable : '',
    mergeState: typeof d.mergeState === 'string' ? d.mergeState : '',
    checks: (['success', 'failure', 'pending'].includes(String(d.checks)) ? d.checks : '') as ChecksState,
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : null,
    updatedAt: r.occurred_at,
  };
}

function runDto(r: ItemRow): RunDto {
  const d = data(r);
  return {
    id: r.id,
    repo: r.repo,
    name: r.title,
    url: r.url,
    branch: r.branch,
    sha: r.sha,
    status: String(d.status ?? ''),
    conclusion: String(d.conclusion ?? ''),
    event: String(d.event ?? ''),
    actor: r.author,
    at: r.occurred_at,
  };
}

function releaseDto(r: ItemRow): ReleaseDto {
  const d = data(r);
  return { id: r.id, repo: r.repo, tag: String(d.tag ?? ''), name: r.title, url: r.url, author: r.author, draft: d.draft === true, prerelease: d.prerelease === true, at: r.occurred_at };
}

export function deployDto(r: ItemRow): DeployDto {
  const d = data(r);
  const state = (['building', 'queued', 'ready', 'error', 'canceled'].includes(r.state) ? r.state : 'building') as DeployState;
  return {
    id: r.id,
    connectionId: r.connection_id,
    project: r.repo,
    projectId: String(d.projectId ?? ''),
    url: r.url,
    inspectorUrl: String(d.inspectorUrl ?? ''),
    state,
    target: d.target === 'production' ? 'production' : 'preview',
    serving: d.serving === true,
    branch: r.branch,
    sha: r.sha,
    commitMessage: r.title,
    prNumber: typeof d.prNumber === 'number' ? d.prNumber : null,
    creator: r.author,
    at: r.occurred_at,
    readyAt: typeof d.readyAt === 'string' ? d.readyAt : null,
  };
}

async function items(actor: FleetActor, kind: string, limit: number): Promise<ItemRow[]> {
  return (await db()
    .prepare('SELECT * FROM fleet_items WHERE workspace_id = ? AND person_id = ? AND kind = ? ORDER BY occurred_at DESC LIMIT ?')
    .all(actor.ws, actor.person, kind, limit)) as ItemRow[];
}

export async function listPulls(actor: FleetActor): Promise<PullDto[]> {
  return (await items(actor, 'pr', 300)).map(pullDto);
}
export async function listRuns(actor: FleetActor): Promise<RunDto[]> {
  return (await items(actor, 'run', 100)).map(runDto);
}
export async function listReleases(actor: FleetActor): Promise<ReleaseDto[]> {
  return (await items(actor, 'release', 30)).map(releaseDto);
}
export async function listDeploys(actor: FleetActor): Promise<DeployDto[]> {
  return (await items(actor, 'deploy', 200)).map(deployDto);
}

/** PRs abiertos y deploys de un conjunto de ramas (para las tarjetas de las sesiones). */
export async function itemsForBranches(actor: FleetActor, branches: string[]): Promise<{ pulls: PullDto[]; deploys: DeployDto[] }> {
  const list = [...new Set(branches.filter(Boolean))].slice(0, 200);
  if (!list.length) return { pulls: [], deploys: [] };
  const rows = (await db()
    .prepare(
      `SELECT * FROM fleet_items WHERE workspace_id = ? AND person_id = ? AND kind IN ('pr', 'deploy') AND branch IN (${list.map(() => '?').join(',')})
       ORDER BY occurred_at DESC`,
    )
    .all(actor.ws, actor.person, ...list)) as ItemRow[];
  return { pulls: rows.filter((r) => r.kind === 'pr').map(pullDto), deploys: rows.filter((r) => r.kind === 'deploy').map(deployDto) };
}

// ---------- Ajustes ----------

export async function getPrefs(actor: Pick<FleetActor, 'ws' | 'person'>): Promise<FleetPrefs> {
  const row = (await db().prepare('SELECT data FROM fleet_prefs WHERE workspace_id = ? AND person_id = ?').get(actor.ws, actor.person)) as { data: string } | undefined;
  if (!row) return { ...DEFAULT_PREFS };
  try {
    const d = JSON.parse(row.data) as Partial<FleetPrefs>;
    return {
      mirrorInbox: d.mirrorInbox === true,
      mirrorLines: d.mirrorLines === true,
      notify: d.notify === 'done' || d.notify === 'waiting' || d.notify === 'both' ? d.notify : 'off',
      notifyAccountId: typeof d.notifyAccountId === 'string' ? d.notifyAccountId : '',
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function setPrefs(actor: FleetActor, patch: Partial<FleetPrefs>): Promise<FleetPrefs> {
  const next = { ...(await getPrefs(actor)), ...patch };
  await db()
    .prepare(
      `INSERT INTO fleet_prefs (workspace_id, person_id, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, person_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(actor.ws, actor.person, JSON.stringify(next), nowIso());
  return next;
}
