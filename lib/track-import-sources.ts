/**
 * Track — import: lectura de GitHub Issues (REST con token personal). Cada llamada a un `fetch…Step`
 * trae una página y devuelve los issues ya normalizados y el cursor para la
 * siguiente; el runner (lib/import-runner.ts) los deja en import_job_items y
 * sigue en el próximo paso, así un repo grande no tiene que entrar en un
 * request. El token llega descifrado del job y solo viaja en el header.
 */
import { ImportError, sourceBase, sourceFetch } from './import-jobs';
import {
  finishIssue,
  normalizeDate,
  normalizeDay,
  normalizePriority,
  safeImportColor,
  type ImportPriority,
  type NormalizedIssue,
} from './track-import-map';

export interface FetchStepResult {
  items: Array<{ kind: string; data: unknown }>;
  cursor: Record<string, unknown>;
  done: boolean;
  /** Fase de lectura para mostrar en el progreso (read:issues). */
  stage?: string;
}

// Linear por API: lib/track-linear-import.ts (workspace entero).

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
