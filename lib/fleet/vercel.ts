/**
 * Fleet: Vercel con un token por cuenta o equipo. Server-only.
 *
 * Cada sincronización lee los proyectos (con el deploy que sirve producción) y los últimos deploys (estado, rama,
 * commit y PR). Los parsers son puros y se prueban con respuestas reales de la API. Nunca escribe en Vercel.
 */
import { fleetFetch } from './http';
import { FleetError, clip, type DeployState } from './types';

const API = 'https://api.vercel.com';

type Obj = Record<string, unknown>;
function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}
function s(v: unknown, max = 500): string {
  return typeof v === 'string' ? clip(v, max) : typeof v === 'number' ? String(v) : '';
}
function msIso(v: unknown): string | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

export interface ParsedProject {
  externalId: string;
  name: string;
  /** Id del deploy que sirve producción ('' si no hay). */
  productionDeploymentId: string;
  url: string;
  framework: string;
  updatedAt: string | null;
}

export interface ParsedDeploy {
  externalId: string;
  project: string;
  projectId: string;
  url: string;
  inspectorUrl: string;
  state: DeployState;
  target: 'production' | 'preview';
  branch: string;
  sha: string;
  commitMessage: string;
  prNumber: number | null;
  creator: string;
  at: string | null;
  readyAt: string | null;
}

/** state/readyState de Vercel → estado del tablero. */
export function deployStateOf(v: unknown): DeployState {
  switch (typeof v === 'string' ? v.toUpperCase() : '') {
    case 'READY':
      return 'ready';
    case 'ERROR':
      return 'error';
    case 'CANCELED':
      return 'canceled';
    case 'QUEUED':
      return 'queued';
    default:
      // BUILDING, INITIALIZING y lo que no se conoce todavía: en curso.
      return 'building';
  }
}

function https(url: string): string {
  if (!url) return '';
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

/** GET /v9/projects → proyectos. */
export function parseProjects(body: unknown): ParsedProject[] {
  const list = obj(body).projects;
  if (!Array.isArray(list)) return [];
  const out: ParsedProject[] = [];
  for (const raw of list) {
    const p = obj(raw);
    const id = s(p.id, 100);
    if (!id) continue;
    const prod = obj(obj(p.targets).production);
    const alias = Array.isArray(prod.alias) ? s(prod.alias[0], 300) : '';
    out.push({
      externalId: id,
      name: s(p.name, 200),
      productionDeploymentId: s(prod.id, 100),
      url: https(alias || s(prod.url, 300)),
      framework: s(p.framework, 60),
      updatedAt: msIso(p.updatedAt),
    });
  }
  return out;
}

/** GET /v6/deployments → deploys. */
export function parseDeployments(body: unknown, projectNames: ReadonlyMap<string, string> = new Map()): ParsedDeploy[] {
  const list = obj(body).deployments;
  if (!Array.isArray(list)) return [];
  const out: ParsedDeploy[] = [];
  for (const raw of list) {
    const d = obj(raw);
    const id = s(d.uid ?? d.id, 100);
    if (!id) continue;
    const meta = obj(d.meta);
    const projectId = s(d.projectId, 100);
    const pr = Number(meta.githubPrId);
    out.push({
      externalId: id,
      project: s(d.name, 200) || projectNames.get(projectId) || '',
      projectId,
      url: https(s(d.url, 300)),
      inspectorUrl: s(d.inspectorUrl, 400),
      state: deployStateOf(d.state ?? d.readyState),
      target: d.target === 'production' ? 'production' : 'preview',
      branch: s(meta.githubCommitRef ?? meta.gitlabCommitRef ?? meta.bitbucketCommitRef, 200),
      sha: s(meta.githubCommitSha ?? meta.gitlabCommitSha ?? meta.bitbucketCommitSha, 64),
      commitMessage: clip(s(meta.githubCommitMessage ?? meta.gitlabCommitMessage, 2000).split('\n')[0] ?? '', 300),
      prNumber: Number.isInteger(pr) && pr > 0 ? pr : null,
      creator: s(obj(d.creator).username ?? meta.githubCommitAuthorLogin, 100),
      at: msIso(d.created ?? d.createdAt),
      readyAt: msIso(d.ready),
    });
  }
  return out;
}

/** GET /v2/teams → equipos del token. */
export function parseTeams(body: unknown): Array<{ id: string; slug: string; name: string }> {
  const list = obj(body).teams;
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => obj(raw))
    .filter((t) => s(t.id, 100))
    .map((t) => ({ id: s(t.id, 100), slug: s(t.slug, 100), name: s(t.name, 200) || s(t.slug, 100) }));
}

// ---------- Red ----------

function q(teamId: string, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  if (teamId) p.set('teamId', teamId);
  const str = p.toString();
  return str ? `?${str}` : '';
}

async function vc(token: string, path: string): Promise<unknown> {
  const res = await fleetFetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}`, 'user-agent': 'zerosoft-fleet' } });
  if (res.status === 401) throw new FleetError('vercel_unauthorized', 400);
  if (res.status === 403) throw new FleetError('vercel_forbidden', 400);
  if (res.status === 429) throw new FleetError('vercel_rate_limited', 400);
  if (!res.ok) throw new FleetError('vercel_error', 502);
  return res.json().catch(() => {
    throw new FleetError('vercel_error', 502);
  });
}

/** Valida el token: usuario y equipos que ve. */
export async function vercelWhoAmI(token: string): Promise<{ username: string; teams: Array<{ id: string; slug: string; name: string }> }> {
  const me = obj(obj(await vc(token, '/v2/user')).user);
  const username = s(me.username ?? me.email, 100);
  if (!username) throw new FleetError('vercel_unauthorized', 400);
  const teams = await vc(token, '/v2/teams?limit=50').then(parseTeams).catch(() => []);
  return { username, teams };
}

export interface VercelSnapshot {
  projects: ParsedProject[];
  deployments: ParsedDeploy[];
}

/** Proyectos (hasta 50) y los últimos 40 deploys del equipo; `projectIds` filtra (vacío = todos). */
export async function vercelSnapshot(token: string, teamId: string, projectIds: readonly string[] = []): Promise<VercelSnapshot> {
  const allProjects = parseProjects(await vc(token, `/v9/projects${q(teamId, { limit: '50' })}`));
  const projects = projectIds.length ? allProjects.filter((p) => projectIds.includes(p.externalId)) : allProjects;
  const names = new Map(projects.map((p) => [p.externalId, p.name]));
  let deployments: ParsedDeploy[];
  if (projectIds.length && projectIds.length <= 5) {
    const lists = await Promise.all(projectIds.map((pid) => vc(token, `/v6/deployments${q(teamId, { limit: '15', projectId: pid })}`).then((b) => parseDeployments(b, names))));
    deployments = lists.flat();
  } else {
    deployments = parseDeployments(await vc(token, `/v6/deployments${q(teamId, { limit: '40' })}`), names);
    if (projectIds.length) deployments = deployments.filter((d) => projectIds.includes(d.projectId));
  }
  return { projects, deployments };
}
