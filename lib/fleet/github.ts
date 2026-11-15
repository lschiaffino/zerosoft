/**
 * Fleet: GitHub con un token (fine-grained o clásico) por cuenta. Server-only.
 *
 * Por repo elegido, cada sincronización hace tres pedidos: una consulta GraphQL con los PRs abiertos (autor, rama,
 * borrador, auto-merge, mergeable y el estado del CI del último commit), las últimas corridas de Actions y los
 * últimos releases. Los parsers son puros y se prueban con las respuestas reales de la API (tests/unit/fleet-*.test.ts).
 *
 * Permisos del token fine-grained (solo lectura): Pull requests, Actions, Contents (releases), Commit statuses y
 * Metadata. Nunca escribe en GitHub.
 */
import { fleetFetch } from './http';
import { FleetError, clip, type ChecksState } from './types';

const API = 'https://api.github.com';

export interface ParsedPull {
  externalId: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  branch: string;
  sha: string;
  draft: boolean;
  autoMerge: boolean;
  mergeable: string;
  mergeState: string;
  checks: ChecksState;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ParsedRun {
  externalId: string;
  repo: string;
  name: string;
  url: string;
  branch: string;
  sha: string;
  status: string;
  conclusion: string;
  event: string;
  actor: string;
  at: string | null;
}

export interface ParsedRelease {
  externalId: string;
  repo: string;
  tag: string;
  name: string;
  url: string;
  author: string;
  draft: boolean;
  prerelease: boolean;
  at: string | null;
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}
function s(v: unknown, max = 500): string {
  return typeof v === 'string' ? clip(v, max) : '';
}
function iso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** "owner/name" válido de GitHub. */
export function isRepoName(v: unknown): v is string {
  // Dueño: letras, números y guiones (nunca '.' ni '..'); repo: también puntos y _, salvo '.' y '..'.
  return typeof v === 'string' && /^[A-Za-z0-9-]{1,39}\/(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$/.test(v);
}

/** statusCheckRollup.state de GitHub → éxito, falla o en curso. */
export function checksFromRollup(state: unknown): ChecksState {
  switch (typeof state === 'string' ? state.toUpperCase() : '') {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'ERROR':
      return 'failure';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return '';
  }
}

export const PULLS_QUERY = `query FleetPulls($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        id number title url isDraft createdAt updatedAt headRefName headRefOid mergeable mergeStateStatus
        author { login }
        autoMergeRequest { enabledAt }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

/** Respuesta de PULLS_QUERY → PRs abiertos. */
export function parsePullsGraphql(repo: string, body: unknown): ParsedPull[] {
  const b = obj(body);
  if (Array.isArray(b.errors) && b.errors.length && !b.data) {
    const first = obj(b.errors[0]);
    throw new FleetError(s(first.type) === 'NOT_FOUND' ? 'repo_not_found' : 'github_error', 502);
  }
  const nodes = obj(obj(obj(obj(b.data).repository).pullRequests)).nodes;
  if (!Array.isArray(nodes)) return [];
  const out: ParsedPull[] = [];
  for (const raw of nodes) {
    const n = obj(raw);
    const number = Number(n.number);
    if (!Number.isInteger(number) || number <= 0) continue;
    const commitNodes = obj(n.commits).nodes;
    const last = Array.isArray(commitNodes) && commitNodes.length ? obj(obj(commitNodes[commitNodes.length - 1]).commit) : {};
    out.push({
      externalId: `${repo}#${number}`,
      repo,
      number,
      title: s(n.title, 300),
      url: s(n.url, 400),
      author: s(obj(n.author).login, 100),
      branch: s(n.headRefName, 200),
      sha: s(n.headRefOid, 64),
      draft: n.isDraft === true,
      autoMerge: n.autoMergeRequest != null && typeof n.autoMergeRequest === 'object',
      mergeable: s(n.mergeable, 20).toUpperCase(),
      mergeState: s(n.mergeStateStatus, 20).toLowerCase(),
      checks: checksFromRollup(obj(last.statusCheckRollup).state),
      createdAt: iso(n.createdAt),
      updatedAt: iso(n.updatedAt),
    });
  }
  return out;
}

/** GET /repos/{repo}/actions/runs → corridas. */
export function parseRuns(repo: string, body: unknown): ParsedRun[] {
  const runs = obj(body).workflow_runs;
  if (!Array.isArray(runs)) return [];
  const out: ParsedRun[] = [];
  for (const raw of runs) {
    const r = obj(raw);
    const id = r.id;
    if (typeof id !== 'number' && typeof id !== 'string') continue;
    out.push({
      externalId: `${repo}/runs/${id}`,
      repo,
      name: s(r.name ?? r.display_title, 200),
      url: s(r.html_url, 400),
      branch: s(r.head_branch, 200),
      sha: s(r.head_sha, 64),
      status: s(r.status, 30),
      conclusion: s(r.conclusion, 30),
      event: s(r.event, 40),
      actor: s(obj(r.actor).login ?? obj(r.triggering_actor).login, 100),
      at: iso(r.updated_at ?? r.created_at),
    });
  }
  return out;
}

/** GET /repos/{repo}/releases → releases. */
export function parseReleases(repo: string, body: unknown): ParsedRelease[] {
  if (!Array.isArray(body)) return [];
  const out: ParsedRelease[] = [];
  for (const raw of body) {
    const r = obj(raw);
    if (typeof r.id !== 'number' && typeof r.id !== 'string') continue;
    out.push({
      externalId: `${repo}/releases/${r.id}`,
      repo,
      tag: s(r.tag_name, 200),
      name: s(r.name, 300) || s(r.tag_name, 200),
      url: s(r.html_url, 400),
      author: s(obj(r.author).login, 100),
      draft: r.draft === true,
      prerelease: r.prerelease === true,
      at: iso(r.published_at ?? r.created_at),
    });
  }
  return out;
}

/** GET /user/repos → "owner/name" de los repos que ve el token (los más recientes primero). */
export function parseRepoList(body: unknown): Array<{ fullName: string; private: boolean; pushedAt: string | null }> {
  if (!Array.isArray(body)) return [];
  return body
    .map((raw) => obj(raw))
    .filter((r) => isRepoName(r.full_name))
    .map((r) => ({ fullName: r.full_name as string, private: r.private === true, pushedAt: iso(r.pushed_at) }));
}

// ---------- Red ----------

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'zerosoft-fleet',
  };
}

async function gh(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fleetFetch(`${API}${path}`, { ...init, headers: { ...headers(token), ...(init.headers as Record<string, string> | undefined) } });
  if (res.status === 401) throw new FleetError('github_unauthorized', 400);
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    throw new FleetError(remaining === '0' || res.status === 429 ? 'github_rate_limited' : 'github_forbidden', 400);
  }
  if (res.status === 404) throw new FleetError('repo_not_found', 400);
  if (!res.ok) throw new FleetError('github_error', 502);
  return res.json().catch(() => {
    throw new FleetError('github_error', 502);
  });
}

/** Valida el token y devuelve la cuenta (login). */
export async function githubWhoAmI(token: string): Promise<{ login: string }> {
  const me = obj(await gh(token, '/user'));
  const login = s(me.login, 100);
  if (!login) throw new FleetError('github_unauthorized', 400);
  return { login };
}

/** Repos que ve el token (hasta 100, los empujados más recientemente primero). */
export async function githubRepos(token: string) {
  return parseRepoList(await gh(token, '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member'));
}

export interface RepoSnapshot {
  repo: string;
  pulls: ParsedPull[];
  runs: ParsedRun[];
  releases: ParsedRelease[];
}

export async function githubSnapshot(token: string, repo: string): Promise<RepoSnapshot> {
  if (!isRepoName(repo)) throw new FleetError('repo_not_found', 400);
  const [owner, name] = repo.split('/');
  const [pulls, runs, releases] = await Promise.all([
    gh(token, '/graphql', { method: 'POST', body: JSON.stringify({ query: PULLS_QUERY, variables: { owner, name } }), headers: { 'content-type': 'application/json' } }).then((b) =>
      parsePullsGraphql(repo, b),
    ),
    gh(token, `/repos/${owner}/${name}/actions/runs?per_page=10`).then((b) => parseRuns(repo, b)),
    gh(token, `/repos/${owner}/${name}/releases?per_page=5`).then((b) => parseReleases(repo, b)),
  ]);
  return { repo, pulls, runs, releases };
}
