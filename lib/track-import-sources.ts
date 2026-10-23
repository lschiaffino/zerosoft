/**
 * Track — import: lectura de Linear (GraphQL con API key personal) y de
 * GitHub Issues (REST con token personal). Cada llamada a un `fetch…Step`
 * trae una página y devuelve los issues ya normalizados y el cursor para la
 * siguiente; el runner (lib/import-runner.ts) los deja en import_job_items y
 * sigue en el próximo paso, así un repo grande no tiene que entrar en un
 * request. El token llega descifrado del job y solo viaja en el header.
 */
import { ImportError, ImportRetryError, sourceBase, sourceFetch } from './import-jobs';
import {
  finishIssue,
  linearStateCategory,
  normalizeDate,
  normalizeDay,
  normalizeEstimate,
  normalizePriority,
  safeImportColor,
  type ImportPriority,
  type NormalizedIssue,
} from './track-import-map';

export interface FetchStepResult {
  items: Array<{ kind: string; data: unknown }>;
  cursor: Record<string, unknown>;
  done: boolean;
}

// ---------- Linear ----------

const LINEAR_PAGE = 50;

const LINEAR_ISSUES_QUERY = `query Issues($after: String) {
  issues(first: ${LINEAR_PAGE}, after: $after, orderBy: createdAt) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id identifier title description priority estimate createdAt dueDate
      state { name type color }
      team { key name }
      project { name description targetDate }
      cycle { number name startsAt endsAt }
      assignee { email name }
      parent { identifier }
      labels(first: 20) { nodes { name color } }
      comments(first: 50) { nodes { id body createdAt user { email name } } }
    }
  }
}`;

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  estimate?: number | null;
  createdAt?: string | null;
  dueDate?: string | null;
  state?: { name: string; type: string; color?: string | null } | null;
  team?: { key: string; name: string } | null;
  project?: { name: string; description?: string | null; targetDate?: string | null } | null;
  cycle?: { number: number; name?: string | null; startsAt: string; endsAt: string } | null;
  assignee?: { email?: string | null; name?: string | null } | null;
  parent?: { identifier: string } | null;
  labels?: { nodes: Array<{ name: string; color?: string | null }> } | null;
  comments?: { nodes: Array<{ id: string; body: string; createdAt: string; user?: { email?: string | null; name?: string | null } | null }> } | null;
}

/** API key personal: va tal cual en Authorization; un token OAuth lleva Bearer. */
function linearAuth(token: string): string {
  return /^lin_oauth_/.test(token) ? `Bearer ${token}` : token;
}

async function linearQuery<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${sourceBase('linear', 'https://api.linear.app')}/graphql`, {
      method: 'POST',
      headers: { authorization: linearAuth(token), 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
  } catch {
    throw new ImportError('source_unreachable');
  }
  if (res.status === 429) throw new ImportRetryError(60_000);
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> } | null;
  const err = body?.errors?.[0];
  if (res.status === 401 || res.status === 403 || err?.extensions?.code === 'AUTHENTICATION_ERROR' || /authenticat/i.test(err?.message ?? '')) {
    throw new ImportError('unauthorized');
  }
  if (err?.extensions?.code === 'RATELIMITED') throw new ImportRetryError(60_000);
  if (!res.ok || !body?.data) throw new ImportError('source_error');
  return body.data;
}

export function linearNodeToIssue(n: LinearIssueNode): NormalizedIssue {
  const teamName = n.team?.name || n.team?.key || 'Linear';
  return finishIssue({
    extId: n.identifier,
    key: n.identifier,
    project: { extId: `name:${teamName.toLowerCase()}`, name: teamName, key: n.team?.key ?? null },
    title: n.title || n.identifier,
    description: n.description ?? '',
    status: {
      name: n.state?.name ?? null,
      category: linearStateCategory(n.state?.type) ?? 'todo',
      color: safeImportColor(n.state?.color),
    },
    priority: normalizePriority(n.priority ?? 0),
    assignee: n.assignee ? { email: n.assignee.email?.toLowerCase() ?? null, name: n.assignee.name ?? null } : null,
    estimate: normalizeEstimate(n.estimate),
    labels: (n.labels?.nodes ?? []).map((l) => ({ name: l.name, color: safeImportColor(l.color) })),
    cycle:
      n.cycle && n.cycle.startsAt && n.cycle.endsAt
        ? {
            extId: `${teamName}:${n.cycle.name || n.cycle.number}`,
            name: n.cycle.name || `Cycle ${n.cycle.number}`,
            startAt: n.cycle.startsAt.slice(0, 10),
            endAt: n.cycle.endsAt.slice(0, 10),
          }
        : null,
    // Los proyectos de Linear cruzan teams: acá un team es un proyecto y un
    // proyecto de Linear pasa a ser un milestone dentro de ese proyecto.
    milestone: n.project
      ? { extId: `${teamName}:${n.project.name}`, name: n.project.name, targetDate: normalizeDay(n.project.targetDate) }
      : null,
    parentExtId: n.parent?.identifier ?? null,
    createdAt: normalizeDate(n.createdAt),
    dueDate: normalizeDay(n.dueDate),
    comments: (n.comments?.nodes ?? []).map((c) => ({
      extId: c.id,
      authorEmail: c.user?.email?.toLowerCase() ?? null,
      authorName: c.user?.name ?? null,
      body: c.body ?? '',
      createdAt: normalizeDate(c.createdAt),
    })),
  });
}

export async function fetchLinearStep(token: string, cursor: Record<string, unknown>): Promise<FetchStepResult> {
  const after = typeof cursor.after === 'string' ? cursor.after : null;
  const data = await linearQuery<{ issues: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: LinearIssueNode[] } }>(
    token,
    LINEAR_ISSUES_QUERY,
    { after },
  );
  const page = data.issues;
  return {
    items: page.nodes.map((n) => ({ kind: 'issue', data: linearNodeToIssue(n) })),
    cursor: { after: page.pageInfo.endCursor },
    done: !page.pageInfo.hasNextPage || !page.pageInfo.endCursor,
  };
}

// ---------- GitHub ----------

const GITHUB_PAGE = 100;
export const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

interface GithubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  state_reason?: string | null;
  created_at: string;
  pull_request?: unknown;
  labels?: Array<{ name: string; color?: string | null } | string>;
  assignee?: { login: string } | null;
  milestone?: { number: number; title: string; due_on?: string | null } | null;
  user?: { login: string } | null;
}

interface GithubComment {
  id: number;
  body?: string | null;
  created_at: string;
  issue_url: string;
  user?: { login: string } | null;
}

function githubHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'zerosoft-import',
  };
}

/** "priority: high", "P1", "urgent" como label → prioridad (el label queda igual). */
export function priorityFromLabels(labels: string[]): ImportPriority | null {
  for (const l of labels) {
    const m = /^(?:priority|prio|p)[\s:/_-]*(urgent|critical|high|medium|normal|low|[0-4])$/i.exec(l.trim());
    if (m) return /^\d$/.test(m[1]) ? (['urgent', 'urgent', 'high', 'medium', 'low'] as const)[Number(m[1])] : normalizePriority(m[1]);
    if (/^(urgent|critical)$/i.test(l.trim())) return 'urgent';
  }
  return null;
}

export function githubIssueToNormalized(repo: string, i: GithubIssue): NormalizedIssue {
  const repoKey = repo.toLowerCase();
  const name = repo.split('/')[1] ?? repo;
  const labels = (i.labels ?? []).map((l) => (typeof l === 'string' ? { name: l, color: null } : { name: l.name, color: safeImportColor(l.color) }));
  const closedAs = i.state_reason === 'not_planned' ? 'cancelled' : 'done';
  return finishIssue({
    extId: `${repoKey}#${i.number}`,
    key: `#${i.number}`,
    project: { extId: `github:${repoKey}`, name, key: null },
    title: i.title || `#${i.number}`,
    description: i.body ?? '',
    status: { name: null, category: i.state === 'closed' ? closedAs : 'todo' },
    priority: priorityFromLabels(labels.map((l) => l.name)) ?? 'medium',
    assignee: i.assignee ? { email: null, name: i.assignee.login } : null,
    estimate: null,
    labels,
    cycle: null,
    milestone: i.milestone
      ? { extId: `${repoKey}:milestone:${i.milestone.number}`, name: i.milestone.title, targetDate: normalizeDay(i.milestone.due_on) }
      : null,
    parentExtId: null,
    createdAt: normalizeDate(i.created_at),
    dueDate: null,
    comments: [],
  });
}

/**
 * Pasos: repo (valida el token y el nombre) → issues página a página (sin
 * PRs) → comentarios del repo página a página. Los comentarios quedan como
 * items aparte (kind 'comment') que el writer cuelga de su issue.
 */
export async function fetchGithubStep(token: string, repo: string, cursor: Record<string, unknown>): Promise<FetchStepResult> {
  if (!GITHUB_REPO_RE.test(repo)) throw new ImportError('invalid_repo');
  const base = sourceBase('github', 'https://api.github.com');
  const headers = githubHeaders(token);
  const phase = (cursor.phase as string) || 'repo';

  if (phase === 'repo') {
    await sourceFetch(`${base}/repos/${repo}`, { headers });
    return { items: [], cursor: { phase: 'issues', page: 1 }, done: false };
  }

  const page = Number(cursor.page) || 1;
  if (phase === 'issues') {
    const { data } = await sourceFetch<GithubIssue[]>(
      `${base}/repos/${repo}/issues?state=all&per_page=${GITHUB_PAGE}&page=${page}&sort=created&direction=asc`,
      { headers },
    );
    const items = data.filter((i) => !i.pull_request).map((i) => ({ kind: 'issue', data: githubIssueToNormalized(repo, i) }));
    const next = data.length < GITHUB_PAGE ? { phase: 'comments', page: 1 } : { phase: 'issues', page: page + 1 };
    return { items, cursor: next, done: false };
  }

  const { data } = await sourceFetch<GithubComment[]>(
    `${base}/repos/${repo}/issues/comments?per_page=${GITHUB_PAGE}&page=${page}&sort=created&direction=asc`,
    { headers },
  );
  const repoKey = repo.toLowerCase();
  const items = data
    .map((c) => {
      const number = /\/issues\/(\d+)$/.exec(c.issue_url)?.[1];
      if (!number || !c.body?.trim()) return null;
      return {
        kind: 'comment',
        data: {
          issueExtId: `${repoKey}#${number}`,
          comment: {
            extId: String(c.id),
            authorEmail: null,
            authorName: c.user?.login ?? null,
            body: c.body.slice(0, 5000),
            createdAt: normalizeDate(c.created_at),
          },
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return { items, cursor: { phase: 'comments', page: page + 1 }, done: data.length < GITHUB_PAGE };
}
