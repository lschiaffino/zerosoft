/**
 * Track — integración con GitHub por webhook (sin GitHub App).
 *
 * Cada workspace conecta un webhook con un secreto propio (cifrado con
 * lib/secret-box) y una lista de repos. GitHub manda `pull_request` y `push`
 * a /api/track/github/webhook/<hookId>; verificamos X-Hub-Signature-256,
 * buscamos identificadores de issue (PREFIJO-123) en branch, título, cuerpo y
 * mensajes de commit, vinculamos el PR o commit al issue y, según la
 * configuración, movemos el issue a "en curso" al abrir el PR y a "hecho" al
 * mergearlo. El status solo se mueve para los issues del branch, del título o
 * precedidos de una palabra clave (fixes, closes, resolves…) en el cuerpo: un
 * "bloqueado por ZER-11" en la descripción vincula pero no cierra.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import type { TrackStatusRow } from './db';
import { open as openSecret, seal } from './secret-box';
import type { GithubConfigPayload } from './track-schema';

export { branchNameFor } from './track-branch';

// ---------- Tipos ----------

export type PrOpenAction = 'in_progress' | 'none';
export type ChecksState = 'pending' | 'success' | 'failure';
export type PrMergeAction = 'done' | 'none';

export interface GithubConfig {
  id: string;
  workspaceId: string;
  repos: string[];
  /** Instalación de la GitHub App (null si es el webhook manual). */
  installationId: number | null;
  accountLogin: string | null;
  onPrOpen: PrOpenAction;
  onPrMerge: PrMergeAction;
  lastDeliveryAt: string | null;
  createdAt: string;
}

interface GithubRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  secret: string;
  repos: string;
  on_pr_open: string;
  on_pr_merge: string;
  last_delivery_at: string | null;
  installation_id?: number | null;
  account_login?: string | null;
  created_at: string;
}

export interface TrackIssueLink {
  id: string;
  issue_id: string;
  kind: 'pr' | 'commit';
  repo: string;
  ref: string;
  url: string;
  title: string;
  state: 'open' | 'closed' | 'merged' | 'draft' | 'pushed';
  branch: string | null;
  author: string | null;
  /** Estado de los checks del último commit del PR (check suites / statuses). */
  checks?: ChecksState | null;
  /** JSON { login: 'approved' | 'changes_requested' | 'commented' | 'requested' }. */
  reviews?: string | null;
  head_sha?: string | null;
  /** 0 = vinculado con una palabra que no cierra (ref, part of…): no mueve el issue. */
  closes?: number;
  created_at: string;
  updated_at: string;
}

// ---------- Helpers puros ----------

/** Verifica `X-Hub-Signature-256: sha256=<hex>` sobre el cuerpo crudo. */
export function verifyGithubSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const got = header.slice('sha256='.length).trim();
  if (got.length !== expected.length || !/^[0-9a-f]+$/i.test(got)) return false;
  return timingSafeEqual(Buffer.from(got.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'));
}

export function signGithubPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Busca identificadores de issue (PREFIJO-123) en un texto. Los prefijos son
 * los slugs de los proyectos en mayúscula (pueden tener guiones, p. ej.
 * MI-PROYECTO-12). No distingue mayúsculas: en un branch suelen ir en
 * minúscula (zer-123-arreglar-login). Si dos prefijos se pisan, gana el más
 * largo. Devuelve identificadores normalizados (ZER-123), sin repetir.
 */
export function parseIssueIdentifiers(text: string, prefixes: string[]): string[] {
  if (!text || prefixes.length === 0) return [];
  const sorted = Array.from(new Set(prefixes.map((p) => p.toUpperCase()).filter(Boolean))).sort(
    (a, b) => b.length - a.length,
  );
  const taken: Array<[number, number]> = [];
  const found: Array<{ at: number; id: string }> = [];
  for (const prefix of sorted) {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(prefix)}-(\\d{1,9})(?![0-9A-Za-z])`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      found.push({ at: start, id: `${prefix}-${Number(m[1])}` });
    }
  }
  const out: string[] = [];
  for (const f of found.sort((a, b) => a.at - b.at)) if (!out.includes(f.id)) out.push(f.id);
  return out;
}

/**
 * Palabras clave que, delante de un identificador, indican que el PR lo
 * resuelve (como en GitHub/Linear), en inglés, español y portugués.
 */
const CLOSING_KEYWORDS = [
  'close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved',
  'cierra', 'cierro', 'arregla', 'arreglo', 'resuelve', 'soluciona',
  'fecha', 'corrige', 'resolve', 'conserta',
];

/** Vinculan sin cerrar (como en Linear): el PR queda en el issue pero no lo mueve. */
const NON_CLOSING_KEYWORDS = [
  'ref', 'refs', 'references', 'part of', 'contributes to', 'toward', 'towards', 'related to', 'relates to',
  'parte de', 'relacionado con', 'relacionado a', 'contribuye a', 'contribui para',
];

/** Delante de un identificador, evitan el vínculo (skip ZER-1, ignore ZER-2). */
const SKIP_KEYWORDS = ['skip', 'ignore'];

/** Identificadores que siguen a alguna de esas palabras (con listas "ZER-1, ZER-2 y ZER-3"). */
export function parseKeywordIdentifiers(text: string, prefixes: string[], keywords: string[]): string[] {
  if (!text || prefixes.length === 0) return [];
  const kw = Array.from(new Set(keywords))
    .sort((a, b) => b.length - a.length)
    .map((k) => k.split(/\s+/).map(escapeRegex).join('\\s+'))
    .join('|');
  const ref = '[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\\d{1,9}';
  const re = new RegExp(
    `(?<![A-Za-z0-9])(?:${kw})\\b\\s*:?\\s*(${ref}(?:\\s*(?:,|&|\\band\\b|\\by\\b|\\be\\b)\\s*${ref})*)`,
    'gi',
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (const id of parseIssueIdentifiers(m[1], prefixes)) if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function parseNonClosingIdentifiers(text: string, prefixes: string[]): string[] {
  return parseKeywordIdentifiers(text, prefixes, NON_CLOSING_KEYWORDS);
}

export function parseSkippedIdentifiers(text: string, prefixes: string[]): string[] {
  return parseKeywordIdentifiers(text, prefixes, SKIP_KEYWORDS);
}

/**
 * Identificadores precedidos de una palabra clave de cierre ("Fixes ZER-1",
 * "closes: ZER-2, ZER-3 y ZER-4"). Solo cuenta la lista que sigue a la
 * palabra clave; el resto de las menciones no.
 */
export function parseClosingIdentifiers(text: string, prefixes: string[]): string[] {
  if (!text || prefixes.length === 0) return [];
  const kw = Array.from(new Set(CLOSING_KEYWORDS)).join('|');
  const ref = '[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\\d{1,9}';
  const re = new RegExp(
    `(?<![A-Za-z0-9])(?:${kw})\\b\\s*:?\\s*(${ref}(?:\\s*(?:,|&|\\band\\b|\\by\\b|\\be\\b)\\s*${ref})*)`,
    'gi',
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (const id of parseIssueIdentifiers(m[1], prefixes)) if (!out.includes(id)) out.push(id);
  }
  return out;
}

export type GithubEventKind = 'pr_opened' | 'pr_draft' | 'pr_review' | 'pr_merged' | 'pr_closed' | 'pr_updated' | 'push';

/**
 * Categoría a la que hay que mover un issue ante un evento de GitHub, o null
 * si no se toca. Nunca retrocede: un issue hecho o cancelado no vuelve a "en
 * curso", y uno ya en curso no se mueve al abrir otro PR.
 */
export function plannedCategory(
  current: TrackStatusRow['category'] | null,
  event: GithubEventKind,
  config: { onPrOpen: PrOpenAction; onPrMerge: PrMergeAction },
): 'in_progress' | 'done' | null {
  const closed = current === 'done' || current === 'cancelled';
  if (event === 'pr_opened') {
    if (config.onPrOpen !== 'in_progress' || closed || current === 'in_progress') return null;
    return 'in_progress';
  }
  if (event === 'pr_merged') {
    if (config.onPrMerge !== 'done' || closed) return null;
    return 'done';
  }
  return null;
}

// ---------- Config ----------

function rowToConfig(row: GithubRow): GithubConfig {
  let repos: string[] = [];
  try {
    const parsed = JSON.parse(row.repos);
    if (Array.isArray(parsed)) repos = parsed.map(String);
  } catch {
    repos = [];
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    repos,
    onPrOpen: row.on_pr_open === 'none' ? 'none' : 'in_progress',
    onPrMerge: row.on_pr_merge === 'none' ? 'none' : 'done',
    installationId: row.installation_id ?? null,
    accountLogin: row.account_login ?? null,
    lastDeliveryAt: row.last_delivery_at,
    createdAt: row.created_at,
  };
}

async function getRowByWorkspace(workspaceId: string): Promise<GithubRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_github WHERE workspace_id = ?').get(workspaceId)) as
    | GithubRow
    | undefined;
}

export async function getGithubConfig(workspaceId: string): Promise<GithubConfig | null> {
  const row = await getRowByWorkspace(workspaceId);
  return row ? rowToConfig(row) : null;
}

/**
 * Conecta o actualiza el webhook del workspace. Devuelve el secreto en texto
 * plano solo cuando se generó uno nuevo (para pegarlo en GitHub); después
 * nunca se vuelve a mostrar.
 */
export async function saveGithubConfig(
  workspaceId: string,
  ownerId: string,
  payload: GithubConfigPayload,
): Promise<{ config: GithubConfig; secret: string | null }> {
  const db = getDb();
  const existing = await getRowByWorkspace(workspaceId);
  const repos = JSON.stringify(Array.from(new Set(payload.repos.map((r) => r.trim()))));
  let plainSecret: string | null = null;
  if (payload.secret) plainSecret = payload.secret;
  else if (!existing || payload.regenerateSecret) plainSecret = randomBytes(24).toString('hex');

  if (existing) {
    await db
      .prepare(
        `UPDATE track_github SET repos = ?, on_pr_open = ?, on_pr_merge = ?, secret = COALESCE(?, secret),
           updated_at = datetime('now') WHERE id = ?`,
      )
      .run(repos, payload.onPrOpen, payload.onPrMerge, plainSecret ? seal(plainSecret) : null, existing.id);
  } else {
    await db
      .prepare(
        `INSERT INTO track_github (id, workspace_id, owner_id, secret, repos, on_pr_open, on_pr_merge)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomBytes(12).toString('hex'),
        workspaceId,
        ownerId,
        seal(plainSecret as string),
        repos,
        payload.onPrOpen,
        payload.onPrMerge,
      );
  }
  const row = (await getRowByWorkspace(workspaceId)) as GithubRow;
  return { config: rowToConfig(row), secret: payload.secret ? null : plainSecret };
}

export async function deleteGithubConfig(workspaceId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_github WHERE workspace_id = ?').run(workspaceId);
  return res.changes > 0;
}

// ---------- Links ----------

export async function listIssueLinks(issueId: string): Promise<TrackIssueLink[]> {
  return (await getDb()
    .prepare(
      "SELECT * FROM track_issue_links WHERE issue_id = ? ORDER BY CASE kind WHEN 'pr' THEN 0 ELSE 1 END, updated_at DESC LIMIT 50",
    )
    .all(issueId)) as TrackIssueLink[];
}

/**
 * Crea o actualiza el vínculo y devuelve el estado que tenía antes (null si es
 * nuevo). 'merged' es terminal en GitHub: una entrega atrasada o reenviada no
 * lo baja a open/closed.
 */
async function upsertLink(
  issueId: string,
  link: Pick<TrackIssueLink, 'kind' | 'repo' | 'ref' | 'url' | 'title' | 'state' | 'branch' | 'author'> & {
    headSha?: string | null;
    closes?: boolean;
  },
): Promise<TrackIssueLink['state'] | null> {
  const db = getDb();
  const prev = (await db
    .prepare('SELECT state FROM track_issue_links WHERE issue_id = ? AND kind = ? AND repo = ? AND ref = ?')
    .get(issueId, link.kind, link.repo, link.ref)) as { state: TrackIssueLink['state'] } | undefined;
  await db
    .prepare(
      `INSERT INTO track_issue_links (id, issue_id, kind, repo, ref, url, title, state, branch, author, head_sha, closes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (issue_id, kind, repo, ref) DO UPDATE SET
         url = excluded.url, title = excluded.title,
         state = CASE WHEN track_issue_links.state = 'merged' THEN 'merged' ELSE excluded.state END,
         branch = COALESCE(excluded.branch, track_issue_links.branch),
         author = COALESCE(excluded.author, track_issue_links.author),
         head_sha = COALESCE(excluded.head_sha, track_issue_links.head_sha),
         checks = CASE WHEN excluded.head_sha IS NOT NULL AND excluded.head_sha != COALESCE(track_issue_links.head_sha, '') THEN NULL ELSE track_issue_links.checks END,
         closes = excluded.closes,
         updated_at = datetime('now')`,
    )
    .run(
      crypto.randomUUID(),
      issueId,
      link.kind,
      link.repo,
      link.ref,
      link.url,
      link.title.slice(0, 300),
      link.state,
      link.branch,
      link.author,
      link.headSha ?? null,
      link.closes === false ? 0 : 1,
    );
  return prev?.state ?? null;
}

// ---------- Webhook ----------

interface WorkspaceIssue {
  id: string;
  project_id: string;
  status_id?: string | null;
  identifier: string;
  status_category: TrackStatusRow['category'] | null;
  triage: number;
}

async function workspacePrefixes(workspaceId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare('SELECT slug FROM track_projects WHERE COALESCE(team_id, owner_id) = ?')
    .all(workspaceId)) as Array<{ slug: string }>;
  return rows.map((r) => r.slug.toUpperCase());
}

/**
 * Issues del workspace con esos identificadores. Los identificadores se
 * guardan en mayúscula (nextIdentifier usa el slug en mayúscula), así que se
 * compara directo y la query usa UNIQUE(project_id, identifier); el filtro de
 * workspace va sin COALESCE para poder usar idx_track_projects_team.
 */
async function findWorkspaceIssues(workspaceId: string, identifiers: string[]): Promise<WorkspaceIssue[]> {
  if (identifiers.length === 0) return [];
  const ph = identifiers.map(() => '?').join(', ');
  return (await getDb()
    .prepare(
      `SELECT i.id, i.project_id, i.identifier, i.triage, i.status_id, s.category AS status_category
       FROM track_issues i
       JOIN track_projects p ON p.id = i.project_id
       LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE (p.team_id = ? OR (p.team_id IS NULL AND p.owner_id = ?)) AND i.identifier IN (${ph})`,
    )
    .all(workspaceId, workspaceId, ...identifiers.map((i) => i.toUpperCase()))) as WorkspaceIssue[];
}

async function moveIssueToCategory(
  issue: WorkspaceIssue,
  category: 'in_progress' | 'done',
  actorId: string,
  via: { author: string | null; ref: string },
): Promise<boolean> {
  // Un issue en triage todavía no se aceptó: se vincula el PR pero no se le
  // cambia el status (si no, quedaría Done y oculto en la cola de triage).
  if (issue.triage) return false;
  const status = (await getDb()
    .prepare('SELECT id FROM track_statuses WHERE project_id = ? AND category = ? ORDER BY position ASC LIMIT 1')
    .get(issue.project_id, category)) as { id: string } | undefined;
  if (!status) return false;
  const { updateIssue } = await import('./track-data');
  // actorId (el owner) es solo el user_id técnico de la actividad; se firma
  // como GitHub con el autor del PR.
  await updateIssue(issue.id, { statusId: status.id }, actorId, { via: { source: 'github', ...via } });
  return true;
}

/** Tope de identificadores que se procesan por entrega (vínculos). */
export const MAX_LINKED_PER_DELIVERY = 50;
/** Tope de issues a los que una entrega puede cambiarles el status. */
export const MAX_MOVED_PER_DELIVERY = 10;

/**
 * Autores de PR con acceso al repo. Los webhooks de repo también reciben los
 * PRs que abre cualquiera desde un fork: esos no mueven issues ni vinculan
 * menciones sueltas hasta que alguien con acceso los mergea.
 */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export function isTrustedPrAuthor(association: string | null | undefined): boolean {
  return TRUSTED_ASSOCIATIONS.has(String(association ?? '').toUpperCase());
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

interface PrPayload {
  action?: string;
  pull_request?: {
    number?: number;
    html_url?: string;
    title?: string;
    body?: string | null;
    draft?: boolean;
    merged?: boolean;
    state?: string;
    head?: { ref?: string; sha?: string };
    user?: { login?: string };
    author_association?: string;
  };
  requested_reviewer?: { login?: string };
  repository?: { full_name?: string };
}

interface ReviewPayload {
  action?: string;
  review?: { state?: string; user?: { login?: string } };
  pull_request?: { number?: number };
  repository?: { full_name?: string };
}

interface PushPayload {
  ref?: string;
  repository?: { full_name?: string };
  commits?: Array<{ id?: string; message?: string; url?: string; author?: { username?: string; name?: string } }>;
}

interface ChecksPayload {
  action?: string;
  state?: string;
  sha?: string;
  check_suite?: { head_sha?: string; status?: string; conclusion?: string | null };
  repository?: { full_name?: string };
}

interface IssuesPayload {
  action?: string;
  issue?: {
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    state_reason?: string | null;
    pull_request?: unknown;
    user?: { login?: string; type?: string };
  };
  comment?: { id?: number; body?: string; user?: { login?: string; type?: string }; html_url?: string };
  repository?: { full_name?: string };
}

// ---------- Reglas por proyecto ----------

/** Status al que se mueve un issue de ese proyecto en cada momento del PR (null = no se mueve). */
export interface GithubProjectRules {
  projectId: string;
  onDraft: string | null;
  onOpen: string | null;
  onReview: string | null;
  onMerge: string | null;
  /** Repo (owner/name) cuyos issues nuevos entran a este proyecto. */
  syncRepo: string | null;
}

interface RulesRow {
  project_id: string;
  on_draft: string | null;
  on_open: string | null;
  on_review: string | null;
  on_merge: string | null;
  sync_repo: string | null;
}

function rulesFromRow(r: RulesRow): GithubProjectRules {
  return { projectId: r.project_id, onDraft: r.on_draft, onOpen: r.on_open, onReview: r.on_review, onMerge: r.on_merge, syncRepo: r.sync_repo };
}

export async function listGithubRules(workspaceId: string): Promise<GithubProjectRules[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT r.* FROM track_github_rules r JOIN track_projects p ON p.id = r.project_id
       WHERE COALESCE(p.team_id, p.owner_id) = ?`,
    )
    .all(workspaceId)) as RulesRow[];
  return rows.map(rulesFromRow);
}

async function rulesFor(projectId: string): Promise<GithubProjectRules | null> {
  const row = (await getDb().prepare('SELECT * FROM track_github_rules WHERE project_id = ?').get(projectId)) as RulesRow | undefined;
  return row ? rulesFromRow(row) : null;
}

/** Guarda las reglas de un proyecto. Cada status tiene que ser del proyecto. */
export async function saveGithubRules(
  projectId: string,
  input: { onDraft: string | null; onOpen: string | null; onReview: string | null; onMerge: string | null; syncRepo: string | null },
): Promise<'ok' | 'invalid_status'> {
  const db = getDb();
  const statuses = new Set(
    ((await db.prepare('SELECT id FROM track_statuses WHERE project_id = ?').all(projectId)) as Array<{ id: string }>).map((r) => r.id),
  );
  for (const v of [input.onDraft, input.onOpen, input.onReview, input.onMerge]) if (v && !statuses.has(v)) return 'invalid_status';
  await db
    .prepare(
      `INSERT INTO track_github_rules (project_id, on_draft, on_open, on_review, on_merge, sync_repo) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET on_draft = excluded.on_draft, on_open = excluded.on_open, on_review = excluded.on_review,
         on_merge = excluded.on_merge, sync_repo = excluded.sync_repo, updated_at = datetime('now')`,
    )
    .run(projectId, input.onDraft, input.onOpen, input.onReview, input.onMerge, input.syncRepo?.trim().toLowerCase() || null);
  return 'ok';
}

/** Vuelve el proyecto a las reglas del workspace. */
export async function deleteGithubRules(projectId: string): Promise<void> {
  await getDb().prepare('DELETE FROM track_github_rules WHERE project_id = ?').run(projectId);
}

const CATEGORY_ORDER: Record<string, number> = { backlog: 0, todo: 1, in_progress: 2, done: 3, cancelled: 3 };

/**
 * Status destino con reglas del proyecto: nunca saca un issue de done o
 * cancelled ni lo hace retroceder de categoría (un "in review" no vuelve a
 * "in progress" porque se abrió otro PR). Null = no se mueve.
 */
export function plannedStatus(
  current: { statusId: string | null; category: TrackStatusRow['category'] | null },
  event: GithubEventKind,
  rules: GithubProjectRules,
  statuses: Array<Pick<TrackStatusRow, 'id' | 'category'>>,
): string | null {
  const target =
    event === 'pr_draft'
      ? rules.onDraft
      : event === 'pr_opened'
        ? rules.onOpen
        : event === 'pr_review'
          ? rules.onReview
          : event === 'pr_merged'
            ? rules.onMerge
            : null;
  if (!target || target === current.statusId) return null;
  const targetStatus = statuses.find((s) => s.id === target);
  if (!targetStatus) return null;
  if (current.category === 'done' || current.category === 'cancelled') return null;
  if (current.category && CATEGORY_ORDER[targetStatus.category] < CATEGORY_ORDER[current.category]) return null;
  return target;
}

async function moveIssue(
  issue: WorkspaceIssue,
  event: GithubEventKind,
  config: GithubConfig,
  actorId: string,
  via: { author: string | null; ref: string },
): Promise<boolean> {
  if (issue.triage) return false;
  const rules = await rulesFor(issue.project_id);
  if (!rules) {
    const target = plannedCategory(issue.status_category, event, config);
    return target ? moveIssueToCategory(issue, target, actorId, via) : false;
  }
  const statuses = (await getDb()
    .prepare('SELECT id, category FROM track_statuses WHERE project_id = ?')
    .all(issue.project_id)) as Array<Pick<TrackStatusRow, 'id' | 'category'>>;
  const target = plannedStatus({ statusId: issue.status_id ?? null, category: issue.status_category }, event, rules, statuses);
  if (!target) return false;
  const { updateIssue } = await import('./track-data');
  await updateIssue(issue.id, { statusId: target }, actorId, { via: { source: 'github', ...via } });
  return true;
}

// ---------- Webhook ----------

/** Webhook manual de un workspace: /api/track/github/webhook/<hookId>. */
export async function handleGithubWebhook(
  hookId: string,
  event: string | null,
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  const row = (await getDb().prepare('SELECT * FROM track_github WHERE id = ?').get(hookId)) as GithubRow | undefined;
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (!verifyGithubSignature(openSecret(row.secret), rawBody, signature)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }
  return processGithubDelivery(row, event, rawBody);
}

/** Webhook de la GitHub App: una sola URL; la instalación dice de qué workspace es. */
export async function handleGithubAppWebhook(
  appSecret: string | null,
  event: string | null,
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  if (!appSecret || !verifyGithubSignature(appSecret, rawBody, signature)) return { status: 401, body: { error: 'invalid_signature' } };
  let payload: { action?: string; installation?: { id?: number } };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }
  const installationId = payload.installation?.id;
  if (!installationId) return { status: 202, body: { ignored: 'no_installation' } };
  const row = (await getDb().prepare('SELECT * FROM track_github WHERE installation_id = ?').get(installationId)) as GithubRow | undefined;
  if (!row) return { status: 202, body: { ignored: 'unknown_installation' } };
  if (event === 'installation' && (payload.action === 'deleted' || payload.action === 'suspend')) {
    await getDb().prepare('UPDATE track_github SET installation_id = NULL WHERE id = ?').run(row.id);
    return { status: 200, body: { uninstalled: true } };
  }
  if (event === 'installation' || event === 'installation_repositories') return { status: 200, body: { ok: true } };
  return processGithubDelivery(row, event, rawBody);
}

/** Lo común a las dos entradas, con la firma ya verificada. */
async function processGithubDelivery(row: GithubRow, event: string | null, rawBody: string): Promise<WebhookResult> {
  await getDb().prepare("UPDATE track_github SET last_delivery_at = datetime('now') WHERE id = ?").run(row.id);
  if (event === 'ping') return { status: 200, body: { ok: true } };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }
  const config = rowToConfig(row);
  const repo = String((payload as { repository?: { full_name?: string } }).repository?.full_name ?? '');
  // Con la App sin lista, valen todos los repos de la instalación.
  const anyRepo = Boolean(row.installation_id) && config.repos.length === 0;
  if (!repo || (!anyRepo && !config.repos.some((r) => r.toLowerCase() === repo.toLowerCase()))) {
    return { status: 202, body: { ignored: 'repo_not_listed' } };
  }
  const prefixes = await workspacePrefixes(row.workspace_id);

  if (event === 'pull_request') return handlePullRequest(row, config, repo, prefixes, payload as PrPayload);
  if (event === 'pull_request_review') return handleReview(row, repo, payload as ReviewPayload);
  if (event === 'check_suite' || event === 'status') return handleChecks(row, repo, event, payload as ChecksPayload);
  if (event === 'issues' || event === 'issue_comment') return handleIssueSync(row, repo, event, payload as IssuesPayload);

  if (event === 'push') {
    const p = payload as PushPayload;
    const branch = (p.ref ?? '').replace(/^refs\/heads\//, '');
    const branchIds = parseIssueIdentifiers(branch, prefixes);
    // Una sola query para todos los commits.
    const commits = (p.commits ?? [])
      .slice(0, 50)
      .filter((c) => c.id && c.url)
      .map((c) => {
        const skipped = new Set(parseSkippedIdentifiers(c.message ?? '', prefixes));
        return {
          c,
          ids: Array.from(new Set([...branchIds, ...parseIssueIdentifiers(c.message ?? '', prefixes)])).filter((id) => !skipped.has(id)),
        };
      });
    const allIds = Array.from(new Set(commits.flatMap((x) => x.ids))).slice(0, MAX_LINKED_PER_DELIVERY);
    const byIdentifier = new Map<string, WorkspaceIssue[]>();
    for (const issue of await findWorkspaceIssues(row.workspace_id, allIds)) {
      const key = issue.identifier.toUpperCase();
      byIdentifier.set(key, [...(byIdentifier.get(key) ?? []), issue]);
    }
    let linked = 0;
    for (const { c, ids } of commits) {
      for (const issue of ids.flatMap((id) => byIdentifier.get(id) ?? [])) {
        await upsertLink(issue.id, {
          kind: 'commit',
          repo,
          ref: c.id as string,
          url: c.url as string,
          title: (c.message ?? '').split('\n')[0],
          state: 'pushed',
          branch: branch || null,
          author: c.author?.username ?? c.author?.name ?? null,
        });
        linked++;
      }
    }
    return { status: 200, body: { linked } };
  }

  return { status: 202, body: { ignored: 'event' } };
}

/** Acción del PR → momento del flujo (draft, abierto, en review, mergeado). */
export function prEventKind(action: string, pr: { draft?: boolean; merged?: boolean }): GithubEventKind {
  if (action === 'closed') return pr.merged ? 'pr_merged' : 'pr_closed';
  if (action === 'converted_to_draft') return 'pr_draft';
  if (action === 'opened' || action === 'reopened') return pr.draft ? 'pr_draft' : 'pr_opened';
  if (action === 'ready_for_review') return 'pr_opened';
  if (action === 'review_requested') return 'pr_review';
  return 'pr_updated';
}

async function handlePullRequest(
  row: GithubRow,
  config: GithubConfig,
  repo: string,
  prefixes: string[],
  p: PrPayload,
): Promise<WebhookResult> {
  const pr = p.pull_request;
  if (!pr?.number || !pr.html_url) return { status: 400, body: { error: 'invalid_payload' } };
  const branch = pr.head?.ref ?? '';
  const kind = prEventKind(p.action ?? '', pr);
  // Mergear exige acceso de escritura, así que un merge cuenta aunque el PR
  // venga de un fork; antes de eso solo cuenta si el autor tiene acceso.
  const trusted = kind === 'pr_merged' || isTrustedPrAuthor(pr.author_association);
  const text = [pr.title ?? '', pr.body ?? ''].join('\n');
  const skipped = new Set(parseSkippedIdentifiers(text, prefixes));
  const nonClosing = new Set(parseNonClosingIdentifiers(text, prefixes));
  const closing = new Set(parseClosingIdentifiers(pr.body ?? '', prefixes));
  // Mueven: los del branch y el título, y los del cuerpo con palabra de cierre;
  // "ref ZER-1" o "part of ZER-1" solo vinculan y "skip ZER-1" ni eso.
  const movableIds = Array.from(new Set([...parseIssueIdentifiers([branch, pr.title ?? ''].join('\n'), prefixes), ...closing]))
    .filter((id) => !skipped.has(id) && (!nonClosing.has(id) || closing.has(id)))
    .slice(0, MAX_MOVED_PER_DELIVERY);
  const movable = new Set(movableIds);
  // Un PR de alguien sin acceso solo se vincula a los issues que nombra en
  // branch, título o con palabra clave (con tope), y no mueve nada.
  const ids = (
    trusted ? parseIssueIdentifiers([branch, pr.title ?? '', pr.body ?? ''].join('\n'), prefixes).slice(0, MAX_LINKED_PER_DELIVERY) : movableIds
  ).filter((id) => !skipped.has(id));
  const issues = await findWorkspaceIssues(row.workspace_id, ids);
  // El estado del vínculo sale del PR, no de la action: GitHub manda
  // edited/labeled/assigned también para PRs cerrados o mergeados.
  const state: TrackIssueLink['state'] = pr.merged
    ? 'merged'
    : pr.state === 'closed' || kind === 'pr_closed'
      ? 'closed'
      : pr.draft
        ? 'draft'
        : 'open';
  let moved = 0;
  for (const issue of issues) {
    const isMovable = movable.has(issue.identifier.toUpperCase());
    const prevState = await upsertLink(issue.id, {
      kind: 'pr',
      repo,
      ref: String(pr.number),
      url: pr.html_url,
      title: pr.title ?? '',
      state,
      branch: branch || null,
      author: pr.user?.login ?? null,
      headSha: pr.head?.sha ?? null,
      closes: isMovable,
    });
    if (kind === 'pr_review' && p.requested_reviewer?.login) {
      await setReview(issue.id, repo, String(pr.number), p.requested_reviewer.login, 'requested');
    }
    if (!trusted || !isMovable) continue;
    // El merge ya se aplicó (entrega reenviada o atrasada): no volver a cerrar
    // un issue que alguien reabrió a mano, ni mover por una entrega vieja.
    if (prevState === 'merged') continue;
    const via = { author: pr.user?.login ?? null, ref: `#${pr.number}` };
    if (await moveIssue(issue, kind, config, row.owner_id, via)) moved++;
  }
  return { status: 200, body: { linked: issues.length, moved } };
}

async function setReview(issueId: string, repo: string, ref: string, login: string, state: string): Promise<void> {
  const db = getDb();
  const link = (await db
    .prepare("SELECT id, reviews FROM track_issue_links WHERE issue_id = ? AND kind = 'pr' AND repo = ? AND ref = ?")
    .get(issueId, repo, ref)) as { id: string; reviews: string | null } | undefined;
  if (!link) return;
  let reviews: Record<string, string> = {};
  try {
    reviews = JSON.parse(link.reviews ?? '{}') as Record<string, string>;
  } catch {
    reviews = {};
  }
  // Un comentario no pisa una aprobación o un pedido de cambios.
  if (state === 'commented' && reviews[login] && reviews[login] !== 'requested') return;
  reviews[login.slice(0, 60)] = state;
  await db.prepare("UPDATE track_issue_links SET reviews = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(reviews), link.id);
}

async function handleReview(row: GithubRow, repo: string, p: ReviewPayload): Promise<WebhookResult> {
  const number = p.pull_request?.number;
  const login = p.review?.user?.login;
  const state = String(p.review?.state ?? '').toLowerCase();
  if (!number || !login || p.action !== 'submitted') return { status: 202, body: { ignored: 'review' } };
  const mapped = state === 'approved' ? 'approved' : state === 'changes_requested' ? 'changes_requested' : 'commented';
  const links = (await getDb()
    .prepare(
      `SELECT l.issue_id FROM track_issue_links l JOIN track_issues i ON i.id = l.issue_id JOIN track_projects p ON p.id = i.project_id
       WHERE l.kind = 'pr' AND l.repo = ? AND l.ref = ? AND COALESCE(p.team_id, p.owner_id) = ?`,
    )
    .all(repo, String(number), row.workspace_id)) as Array<{ issue_id: string }>;
  for (const l of links) await setReview(l.issue_id, repo, String(number), login, mapped);
  return { status: 200, body: { updated: links.length } };
}

/** Conclusión de GitHub → estado corto de checks. */
export function checksStateFrom(event: string, p: ChecksPayload): { sha: string; state: ChecksState } | null {
  if (event === 'status') {
    if (!p.sha || !p.state) return null;
    return { sha: p.sha, state: p.state === 'success' ? 'success' : p.state === 'pending' ? 'pending' : 'failure' };
  }
  const suite = p.check_suite;
  if (!suite?.head_sha) return null;
  if (suite.status !== 'completed') return { sha: suite.head_sha, state: 'pending' };
  const c = suite.conclusion ?? '';
  return { sha: suite.head_sha, state: c === 'success' || c === 'neutral' || c === 'skipped' ? 'success' : 'failure' };
}

async function handleChecks(row: GithubRow, repo: string, event: string, p: ChecksPayload): Promise<WebhookResult> {
  const parsed = checksStateFrom(event, p);
  if (!parsed) return { status: 202, body: { ignored: 'checks' } };
  // Una falla no la tapa otra suite que termina bien después (mismo commit).
  const res = await getDb()
    .prepare(
      `UPDATE track_issue_links SET checks = CASE
          WHEN ? = 'failure' THEN 'failure'
          WHEN checks = 'failure' AND ? = 'success' THEN 'failure'
          ELSE ? END,
        updated_at = datetime('now')
       WHERE kind = 'pr' AND repo = ? AND head_sha = ? AND issue_id IN (
         SELECT i.id FROM track_issues i JOIN track_projects p ON p.id = i.project_id WHERE COALESCE(p.team_id, p.owner_id) = ?
       )`,
    )
    .run(parsed.state, parsed.state, parsed.state, repo, parsed.sha, row.workspace_id);
  return { status: 200, body: { updated: res.changes } };
}

// ---------- Sync de GitHub Issues (de GitHub a Track) ----------

async function syncProjectFor(workspaceId: string, repo: string): Promise<string | null> {
  const r = (await getDb()
    .prepare(
      `SELECT r.project_id FROM track_github_rules r JOIN track_projects p ON p.id = r.project_id
       WHERE COALESCE(p.team_id, p.owner_id) = ? AND r.sync_repo = ? AND p.status = 'active' LIMIT 1`,
    )
    .get(workspaceId, repo.toLowerCase())) as { project_id: string } | undefined;
  return r?.project_id ?? null;
}

/**
 * issues.opened crea el issue en el proyecto que sincroniza ese repo (pasa
 * por triage si está activo); closed, reopened y edited lo acompañan y los
 * comentarios nuevos entran como comentario. Solo issues nuevos: el histórico
 * se trae con el importador.
 */
async function handleIssueSync(row: GithubRow, repo: string, event: string, p: IssuesPayload): Promise<WebhookResult> {
  const gh = p.issue;
  if (!gh?.number || gh.pull_request) return { status: 202, body: { ignored: 'not_issue' } };
  const projectId = await syncProjectFor(row.workspace_id, repo);
  if (!projectId) return { status: 202, body: { ignored: 'no_sync' } };
  const externalId = `${repo.toLowerCase()}#${gh.number}`;
  const { findExternalRef, upsertExternalRef } = await import('./track-integrations');
  const { textToDescription } = await import('./track-api');
  const { runAsTrackViewer } = await import('./track-access');
  const data = await import('./track-data');
  const ref = await findExternalRef(row.workspace_id, 'github_issue', externalId);

  if (event === 'issue_comment') {
    const c = p.comment;
    if (p.action !== 'created' || !ref || !c?.body?.trim() || c.user?.type === 'Bot') return { status: 202, body: { ignored: 'comment' } };
    const body = `${c.user?.login ?? 'GitHub'} (GitHub): ${c.body.trim()}`.slice(0, 5000);
    await runAsTrackViewer(row.owner_id, () => data.createIssueComment(ref.issue_id, row.owner_id, { body }), 'github');
    return { status: 201, body: { comment: true } };
  }

  if (p.action === 'opened' && !ref) {
    const issue = await runAsTrackViewer(
      row.owner_id,
      () =>
        data.createIssue(
          projectId,
          row.owner_id,
          {
            title: (gh.title || `#${gh.number}`).slice(0, 200),
            description: textToDescription(`${(gh.body ?? '').slice(0, 15_000)}\n\nGitHub: ${gh.html_url ?? ''}`.trim()),
          },
          { source: 'github' },
        ),
      'github',
    );
    await upsertExternalRef({
      issueId: issue.id,
      workspaceId: row.workspace_id,
      provider: 'github_issue',
      externalId,
      url: gh.html_url ?? null,
      title: `${repo}#${gh.number}`,
      state: 'open',
    });
    return { status: 201, body: { issueId: issue.id } };
  }
  if (!ref) return { status: 202, body: { ignored: 'not_synced' } };
  const current = await data.getIssue(ref.issue_id);
  if (!current) return { status: 202, body: { ignored: 'gone' } };
  const via = { source: 'github' as const, author: gh.user?.login ?? null, ref: `#${gh.number}` };
  if (p.action === 'closed' || p.action === 'reopened') {
    const category = p.action === 'reopened' ? 'todo' : gh.state_reason === 'not_planned' ? 'cancelled' : 'done';
    const closed = current.status_category === 'done' || current.status_category === 'cancelled';
    if ((p.action === 'closed' && !closed) || (p.action === 'reopened' && closed)) {
      const status = (await getDb()
        .prepare('SELECT id FROM track_statuses WHERE project_id = ? AND category = ? ORDER BY position LIMIT 1')
        .get(current.project_id, category)) as { id: string } | undefined;
      if (status) await data.updateIssue(current.id, { statusId: status.id }, row.owner_id, { via });
    }
    await upsertExternalRef({
      issueId: current.id,
      workspaceId: row.workspace_id,
      provider: 'github_issue',
      externalId,
      state: p.action === 'closed' ? 'closed' : 'open',
    });
    return { status: 200, body: { updated: true } };
  }
  if (p.action === 'edited' && gh.title && gh.title !== current.title) {
    await data.updateIssue(current.id, { title: gh.title.slice(0, 200) }, row.owner_id, { via });
    return { status: 200, body: { updated: true } };
  }
  return { status: 202, body: { ignored: 'action' } };
}

// ---------- GitHub App ----------

/** Guarda la instalación de la App en el workspace (crea la conexión si no había). */
export async function saveGithubInstallation(
  workspaceId: string,
  ownerId: string,
  installationId: number,
  accountLogin: string | null,
): Promise<GithubConfig> {
  const db = getDb();
  // Una instalación es de un solo workspace.
  await db.prepare('UPDATE track_github SET installation_id = NULL WHERE installation_id = ? AND workspace_id != ?').run(installationId, workspaceId);
  const existing = await getRowByWorkspace(workspaceId);
  if (existing) {
    await db
      .prepare("UPDATE track_github SET installation_id = ?, account_login = ?, updated_at = datetime('now') WHERE id = ?")
      .run(installationId, accountLogin, existing.id);
  } else {
    await db
      .prepare(
        `INSERT INTO track_github (id, workspace_id, owner_id, secret, repos, installation_id, account_login)
         VALUES (?, ?, ?, ?, '[]', ?, ?)`,
      )
      .run(randomBytes(12).toString('hex'), workspaceId, ownerId, seal(randomBytes(24).toString('hex')), installationId, accountLogin);
  }
  return rowToConfig((await getRowByWorkspace(workspaceId)) as GithubRow);
}
