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

// ---------- Tipos ----------

export type PrOpenAction = 'in_progress' | 'none';
export type PrMergeAction = 'done' | 'none';

export interface GithubConfig {
  id: string;
  workspaceId: string;
  repos: string[];
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

/** Nombre de branch sugerido para un issue: zer-123-arreglar-el-login. */
export function branchNameFor(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
    .replace(/-$/, '');
  const id = identifier.toLowerCase();
  return slug ? `${id}-${slug}` : id;
}

export type GithubEventKind = 'pr_opened' | 'pr_merged' | 'pr_closed' | 'pr_updated' | 'push';

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

async function upsertLink(
  issueId: string,
  link: Pick<TrackIssueLink, 'kind' | 'repo' | 'ref' | 'url' | 'title' | 'state' | 'branch' | 'author'>,
): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO track_issue_links (id, issue_id, kind, repo, ref, url, title, state, branch, author)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (issue_id, kind, repo, ref) DO UPDATE SET
         url = excluded.url, title = excluded.title, state = excluded.state,
         branch = COALESCE(excluded.branch, track_issue_links.branch),
         author = COALESCE(excluded.author, track_issue_links.author),
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
    );
}

// ---------- Webhook ----------

interface WorkspaceIssue {
  id: string;
  project_id: string;
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
      `SELECT i.id, i.project_id, i.identifier, i.triage, s.category AS status_category
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
    head?: { ref?: string };
    user?: { login?: string };
    author_association?: string;
  };
  repository?: { full_name?: string };
}

interface PushPayload {
  ref?: string;
  repository?: { full_name?: string };
  commits?: Array<{ id?: string; message?: string; url?: string; author?: { username?: string; name?: string } }>;
}

/**
 * Procesa una entrega del webhook. `rawBody` tiene que ser el cuerpo exacto
 * que mandó GitHub (la firma se calcula sobre esos bytes).
 */
export async function handleGithubWebhook(
  hookId: string,
  event: string | null,
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  const row = (await getDb().prepare('SELECT * FROM track_github WHERE id = ?').get(hookId)) as
    | GithubRow
    | undefined;
  if (!row) return { status: 404, body: { error: 'not_found' } };
  if (!verifyGithubSignature(openSecret(row.secret), rawBody, signature)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }
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
  if (!repo || !config.repos.some((r) => r.toLowerCase() === repo.toLowerCase())) {
    return { status: 202, body: { ignored: 'repo_not_listed' } };
  }
  const prefixes = await workspacePrefixes(row.workspace_id);

  if (event === 'pull_request') {
    const p = payload as PrPayload;
    const pr = p.pull_request;
    if (!pr?.number || !pr.html_url) return { status: 400, body: { error: 'invalid_payload' } };
    const branch = pr.head?.ref ?? '';
    const action = p.action ?? '';
    const kind: GithubEventKind =
      action === 'closed'
        ? pr.merged
          ? 'pr_merged'
          : 'pr_closed'
        : action === 'opened' || action === 'reopened' || action === 'ready_for_review'
          ? 'pr_opened'
          : 'pr_updated';
    // Mergear exige acceso de escritura, así que un merge cuenta aunque el PR
    // venga de un fork; antes de eso solo cuenta si el autor tiene acceso.
    const trusted = kind === 'pr_merged' || isTrustedPrAuthor(pr.author_association);
    // Solo estos cambian de status; las demás menciones del cuerpo solo se vinculan.
    const movableIds = Array.from(
      new Set([
        ...parseIssueIdentifiers([branch, pr.title ?? ''].join('\n'), prefixes),
        ...parseClosingIdentifiers(pr.body ?? '', prefixes),
      ]),
    ).slice(0, MAX_MOVED_PER_DELIVERY);
    const movable = new Set(movableIds);
    // Un PR de alguien sin acceso solo se vincula a los issues que nombra en
    // branch, título o con palabra clave (con tope), y no mueve nada.
    const ids = trusted
      ? parseIssueIdentifiers([branch, pr.title ?? '', pr.body ?? ''].join('\n'), prefixes).slice(
          0,
          MAX_LINKED_PER_DELIVERY,
        )
      : movableIds;
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
      await upsertLink(issue.id, {
        kind: 'pr',
        repo,
        ref: String(pr.number),
        url: pr.html_url,
        title: pr.title ?? '',
        state,
        branch: branch || null,
        author: pr.user?.login ?? null,
      });
      if (!trusted || !movable.has(issue.identifier.toUpperCase())) continue;
      const target = plannedCategory(issue.status_category, kind, config);
      const via = { author: pr.user?.login ?? null, ref: `#${pr.number}` };
      if (target && (await moveIssueToCategory(issue, target, row.owner_id, via))) moved++;
    }
    return { status: 200, body: { linked: issues.length, moved } };
  }

  if (event === 'push') {
    const p = payload as PushPayload;
    const branch = (p.ref ?? '').replace(/^refs\/heads\//, '');
    const branchIds = parseIssueIdentifiers(branch, prefixes);
    // Una sola query para todos los commits (antes era una por commit).
    const commits = (p.commits ?? [])
      .slice(0, 50)
      .filter((c) => c.id && c.url)
      .map((c) => ({
        c,
        ids: Array.from(new Set([...branchIds, ...parseIssueIdentifiers(c.message ?? '', prefixes)])),
      }));
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
