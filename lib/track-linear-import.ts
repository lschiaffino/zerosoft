/**
 * Track — import de un workspace entero de Linear por su API GraphQL, con la
 * API key personal que pega quien importa (cifrada en el job con
 * lib/secret-box y borrada al terminar de leer; nunca se loguea).
 *
 * Lee por fases, cada una paginada sobre las conexiones raíz del schema
 * público de Linear (los campos están revisados contra su schema.graphql en
 * tests/unit/track-linear-import.test.ts):
 *
 *   viewer → users → teams (con sus workflow states) → projects (con
 *   milestones y updates) → cycles → issues → comments → attachments →
 *   issueRelations
 *
 * Cada fase deja items normalizados en import_job_items; el writer
 * (lib/track-import.ts) los procesa en ese orden, así cuando llega un issue
 * ya existen su team, estados, project y cycle, y cuando llegan comentarios,
 * adjuntos y relaciones ya existen todos los issues.
 *
 * Ids externos: el team por su nombre y el issue por su identificador
 * (ENG-12), igual que el CSV de Linear, así CSV y API no se duplican; además
 * el uuid del issue, para seguirlo si cambió de team entre dos corridas.
 */
import { ImportError, ImportRetryError, sourceBase } from './import-jobs';
import {
  clip,
  finishIssue,
  linearStateCategory,
  normalizeDate,
  normalizeDay,
  normalizeEstimate,
  normalizePriority,
  safeImportColor,
  type ImportStatusCategory,
  type NormalizedIssue,
} from './track-import-map';
import type { FetchStepResult } from './track-import-sources';
import { fakeLinearGraphql, isLinearFakeToken, linearFakeAllowed } from './track-linear-fake';

// ---------- Queries (solo campos del schema público de Linear) ----------

const PAGE = 'pageInfo { hasNextPage endCursor }';
const PERSON = '{ email name displayName }';

export const LINEAR_QUERIES = {
  viewer: `query Viewer { viewer { id email name } organization { name urlKey } }`,
  users: `query Users($after: String) {
  users(first: 100, after: $after, includeDisabled: true) { ${PAGE} nodes { id name displayName email active guest } }
}`,
  teams: `query Teams($after: String) {
  teams(first: 25, after: $after) {
    ${PAGE}
    nodes {
      id key name description color private triageEnabled
      states(first: 100) { nodes { id name type color position } }
      members(first: 100) { nodes { email } }
    }
  }
}`,
  projects: `query Projects($after: String) {
  projects(first: 20, after: $after, includeArchived: false) {
    ${PAGE}
    nodes {
      id name description content icon color priority startDate targetDate createdAt updatedAt
      status { type name }
      lead ${PERSON}
      members(first: 50) { nodes ${PERSON} }
      teams(first: 20) { nodes { key name } }
      projectMilestones(first: 50) { nodes { id name description targetDate sortOrder } }
      projectUpdates(first: 50) { nodes { id body health createdAt user ${PERSON} } }
    }
  }
}`,
  cycles: `query Cycles($after: String) {
  cycles(first: 100, after: $after, includeArchived: true) { ${PAGE} nodes { id number name startsAt endsAt team { key name } } }
}`,
  issues: `query Issues($after: String) {
  issues(first: 50, after: $after, includeArchived: true, orderBy: createdAt) {
    ${PAGE}
    nodes {
      id identifier title description priority estimate createdAt updatedAt dueDate archivedAt
      state { id name type color position }
      team { key name }
      project { id name }
      projectMilestone { id name }
      cycle { id number name startsAt endsAt }
      assignee ${PERSON}
      creator ${PERSON}
      parent { id identifier }
      labels(first: 20) { nodes { name color } }
    }
  }
}`,
  comments: `query Comments($after: String) {
  comments(first: 100, after: $after, includeArchived: true, orderBy: createdAt) {
    ${PAGE}
    nodes { id body createdAt updatedAt user ${PERSON} externalUser { name } issue { id identifier } parent { id } }
  }
}`,
  attachments: `query Attachments($after: String) {
  attachments(first: 100, after: $after) { ${PAGE} nodes { id title subtitle url sourceType createdAt issue { id identifier } } }
}`,
  relations: `query Relations($after: String) {
  issueRelations(first: 100, after: $after) { ${PAGE} nodes { id type issue { id identifier } relatedIssue { id identifier } } }
}`,
} as const;

export type LinearPhase = keyof typeof LINEAR_QUERIES;
export const LINEAR_PHASES: LinearPhase[] = ['viewer', 'users', 'teams', 'projects', 'cycles', 'issues', 'comments', 'attachments', 'relations'];
const ROOT_FIELD: Record<Exclude<LinearPhase, 'viewer'>, string> = {
  users: 'users',
  teams: 'teams',
  projects: 'projects',
  cycles: 'cycles',
  issues: 'issues',
  comments: 'comments',
  attachments: 'attachments',
  relations: 'issueRelations',
};

// ---------- Items normalizados ----------

export interface ImportPerson {
  email?: string | null;
  name?: string | null;
}

export interface LinearTeamItem {
  extId: string;
  key: string;
  name: string;
  description: string;
  color: string | null;
  private: boolean;
  triageEnabled: boolean;
  /** Emails de sus miembros (un team privado solo queda visible para ellos). */
  memberEmails: string[];
  states: Array<{ name: string; category: ImportStatusCategory; color: string | null; position: number; triage: boolean }>;
}

export type PlanStatus = 'backlog' | 'planned' | 'in_progress' | 'paused' | 'completed' | 'canceled';
export type PlanHealth = 'on_track' | 'at_risk' | 'off_track';

export interface LinearPlanItem {
  extId: string;
  name: string;
  summary: string;
  description: string;
  icon: string | null;
  color: string | null;
  status: PlanStatus;
  priority: 'none' | 'urgent' | 'high' | 'medium' | 'low';
  startDate: string | null;
  targetDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lead: ImportPerson | null;
  members: ImportPerson[];
  teamExtIds: string[];
  milestones: Array<{ extId: string; name: string; description: string; targetDate: string | null }>;
  updates: Array<{ extId: string; health: PlanHealth; body: string; createdAt: string | null; user: ImportPerson | null }>;
}

export interface LinearCycleItem {
  teamExtId: string;
  extId: string;
  name: string;
  startAt: string;
  endAt: string;
}

export interface LinearAttachmentItem {
  extId: string;
  issueExtId: string;
  url: string;
  title: string;
  subtitle: string;
  sourceType: string | null;
}

export type ImportRelationType = 'blocks' | 'related' | 'duplicates';

export interface LinearRelationItem {
  extId: string;
  issueExtId: string;
  relatedExtId: string;
  type: ImportRelationType;
}

export interface LinearUserItem {
  email: string | null;
  name: string | null;
  active: boolean;
  guest: boolean;
}

/** Id externo del team: por nombre, como lo trae el CSV de Linear (columna Team). */
export function linearTeamExtId(name: string): string {
  return `name:${name.trim().toLowerCase()}`;
}

function person(p: { email?: string | null; name?: string | null; displayName?: string | null } | null | undefined): ImportPerson | null {
  if (!p) return null;
  return { email: p.email?.trim().toLowerCase() || null, name: p.name?.trim() || p.displayName?.trim() || null };
}

const PLAN_STATUS: Record<string, PlanStatus> = {
  backlog: 'backlog',
  planned: 'planned',
  started: 'in_progress',
  paused: 'paused',
  completed: 'completed',
  canceled: 'canceled',
};

const HEALTH: Record<string, PlanHealth> = { onTrack: 'on_track', atRisk: 'at_risk', offTrack: 'off_track' };

export function linearPlanPriority(n: unknown): LinearPlanItem['priority'] {
  return n === 1 ? 'urgent' : n === 2 ? 'high' : n === 3 ? 'medium' : n === 4 ? 'low' : 'none';
}

export function linearRelationType(type: string): ImportRelationType {
  return type === 'blocks' ? 'blocks' : type === 'duplicate' ? 'duplicates' : 'related';
}

// ---------- Nodos de la API → items ----------

/* eslint-disable @typescript-eslint/no-explicit-any -- nodos de la respuesta GraphQL */
export function linearTeamToItem(n: any): LinearTeamItem {
  const states = ((n.states?.nodes ?? []) as any[])
    .slice()
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((s, i) => ({
      name: clip(String(s.name ?? '').trim(), 200),
      category: linearStateCategory(s.type) ?? 'todo',
      color: safeImportColor(s.color),
      position: i,
      triage: s.type === 'triage',
    }))
    .filter((s) => s.name);
  return {
    extId: linearTeamExtId(n.name || n.key),
    key: String(n.key ?? ''),
    name: clip(String(n.name || n.key).trim(), 200),
    description: clip(String(n.description ?? ''), 5000),
    color: safeImportColor(n.color),
    private: !!n.private,
    triageEnabled: !!n.triageEnabled,
    memberEmails: ((n.members?.nodes ?? []) as any[]).map((m) => String(m.email ?? '').toLowerCase()).filter(Boolean),
    states,
  };
}

export function linearProjectToItem(n: any): LinearPlanItem {
  const summary = clip(String(n.description ?? '').trim(), 255);
  return {
    extId: String(n.id),
    name: clip(String(n.name ?? '').trim(), 200) || 'Project',
    summary,
    description: clip(String(n.content ?? '').trim(), 20_000),
    icon: null,
    color: safeImportColor(n.color),
    status: PLAN_STATUS[n.status?.type] ?? 'planned',
    priority: linearPlanPriority(n.priority),
    startDate: normalizeDay(n.startDate),
    targetDate: normalizeDay(n.targetDate),
    createdAt: normalizeDate(n.createdAt),
    updatedAt: normalizeDate(n.updatedAt),
    lead: person(n.lead),
    members: ((n.members?.nodes ?? []) as any[]).map(person).filter((p): p is ImportPerson => !!p),
    teamExtIds: ((n.teams?.nodes ?? []) as any[]).map((t) => linearTeamExtId(t.name || t.key)),
    milestones: ((n.projectMilestones?.nodes ?? []) as any[])
      .slice()
      .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
      .map((m) => ({ extId: String(m.id), name: clip(String(m.name ?? '').trim(), 200), description: clip(String(m.description ?? ''), 5000), targetDate: normalizeDay(m.targetDate) }))
      .filter((m) => m.name),
    updates: ((n.projectUpdates?.nodes ?? []) as any[]).map((u) => ({
      extId: String(u.id),
      health: HEALTH[u.health] ?? 'on_track',
      body: clip(String(u.body ?? ''), 20_000),
      createdAt: normalizeDate(u.createdAt),
      user: person(u.user),
    })),
  };
}

function cycleOf(teamName: string, c: any): NormalizedIssue['cycle'] {
  if (!c?.startsAt || !c?.endsAt) return null;
  const label = c.name || String(c.number);
  return { extId: `${teamName}:${label}`, name: c.name || `Cycle ${c.number}`, startAt: String(c.startsAt).slice(0, 10), endAt: String(c.endsAt).slice(0, 10) };
}

export function linearCycleToItem(n: any): LinearCycleItem | null {
  const teamName = n.team?.name || n.team?.key;
  const c = teamName ? cycleOf(teamName, n) : null;
  return c ? { teamExtId: linearTeamExtId(teamName), ...c } : null;
}

export function linearIssueToItem(n: any): NormalizedIssue {
  const teamName = n.team?.name || n.team?.key || 'Linear';
  return finishIssue({
    extId: n.identifier,
    sourceId: n.id ?? null,
    key: n.identifier,
    project: { extId: linearTeamExtId(teamName), name: teamName, key: n.team?.key ?? null },
    title: n.title || n.identifier,
    description: n.description ?? '',
    status: {
      name: n.state?.type === 'triage' ? null : (n.state?.name ?? null),
      category: linearStateCategory(n.state?.type) ?? 'todo',
      color: safeImportColor(n.state?.color),
    },
    triage: n.state?.type === 'triage',
    priority: normalizePriority(n.priority ?? 0),
    assignee: person(n.assignee),
    creator: person(n.creator),
    estimate: normalizeEstimate(n.estimate),
    labels: ((n.labels?.nodes ?? []) as any[]).map((l) => ({ name: String(l.name), color: safeImportColor(l.color) })),
    cycle: cycleOf(teamName, n.cycle),
    milestone: null,
    plan: n.project ? { extId: String(n.project.id), name: String(n.project.name ?? '') } : null,
    planMilestone: n.projectMilestone ? { extId: String(n.projectMilestone.id), name: String(n.projectMilestone.name ?? '') } : null,
    parentExtId: n.parent?.identifier ?? null,
    createdAt: normalizeDate(n.createdAt),
    updatedAt: normalizeDate(n.updatedAt),
    archivedAt: normalizeDate(n.archivedAt),
    dueDate: normalizeDay(n.dueDate),
    comments: [],
  });
}

function nodeToItems(phase: LinearPhase, n: any): Array<{ kind: string; data: unknown }> {
  switch (phase) {
    case 'users':
      return [{ kind: 'user', data: { email: n.email?.toLowerCase() ?? null, name: n.name || n.displayName || null, active: n.active !== false, guest: !!n.guest } satisfies LinearUserItem }];
    case 'teams':
      return [{ kind: 'team', data: linearTeamToItem(n) }];
    case 'projects':
      return [{ kind: 'plan', data: linearProjectToItem(n) }];
    case 'cycles': {
      const c = linearCycleToItem(n);
      return c ? [{ kind: 'cycle', data: c }] : [];
    }
    case 'issues':
      return [{ kind: 'issue', data: linearIssueToItem(n) }];
    case 'comments': {
      if (!n.issue?.identifier || !String(n.body ?? '').trim()) return [];
      const author = person(n.user) ?? (n.externalUser?.name ? { email: null, name: n.externalUser.name } : null);
      return [
        {
          kind: 'comment',
          data: {
            issueExtId: n.issue.identifier,
            comment: {
              extId: String(n.id),
              parentExtId: n.parent?.id ?? null,
              authorEmail: author?.email ?? null,
              authorName: author?.name ?? null,
              body: clip(String(n.body), 5000),
              createdAt: normalizeDate(n.createdAt),
              updatedAt: normalizeDate(n.updatedAt),
            },
          },
        },
      ];
    }
    case 'attachments':
      if (!n.issue?.identifier || !/^https?:\/\//i.test(String(n.url ?? ''))) return [];
      return [
        {
          kind: 'attachment',
          data: {
            extId: String(n.id),
            issueExtId: n.issue.identifier,
            url: clip(String(n.url), 2000),
            title: clip(String(n.title ?? ''), 300),
            subtitle: clip(String(n.subtitle ?? ''), 300),
            sourceType: n.sourceType ?? null,
          } satisfies LinearAttachmentItem,
        },
      ];
    case 'relations':
      if (!n.issue?.identifier || !n.relatedIssue?.identifier) return [];
      return [
        {
          kind: 'relation',
          data: { extId: String(n.id), issueExtId: n.issue.identifier, relatedExtId: n.relatedIssue.identifier, type: linearRelationType(String(n.type)) } satisfies LinearRelationItem,
        },
      ];
    default:
      return [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- Transporte ----------

/** API key personal: va tal cual en Authorization; un token OAuth lleva Bearer. */
export function linearAuth(token: string): string {
  return /^lin_oauth_/.test(token) ? `Bearer ${token}` : token;
}

export async function linearGraphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  if (linearFakeAllowed() && isLinearFakeToken(token)) {
    const res = fakeLinearGraphql(token, query, variables);
    return handleBody<T>(res.status, res.body);
  }
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
  return handleBody<T>(res.status, await res.json().catch(() => null));
}

type GqlBody<T> = { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> } | null;

function handleBody<T>(status: number, raw: unknown): T {
  const body = raw as GqlBody<T>;
  const err = body?.errors?.[0];
  if (status === 401 || status === 403 || err?.extensions?.code === 'AUTHENTICATION_ERROR' || /authenticat/i.test(err?.message ?? '')) {
    throw new ImportError('unauthorized');
  }
  if (status === 429 || err?.extensions?.code === 'RATELIMITED') throw new ImportRetryError(60_000);
  if (status < 200 || status >= 300 || !body?.data || err) throw new ImportError('source_error');
  return body.data;
}

// ---------- Paso del runner ----------

/**
 * Una página de la fase actual. El cursor lleva la fase y el `after` de
 * Linear; `stage` es la fase (la UI la muestra mientras lee).
 */
export async function fetchLinearWorkspaceStep(token: string, cursor: Record<string, unknown>): Promise<FetchStepResult> {
  const phase = (LINEAR_PHASES.includes(cursor.phase as LinearPhase) ? cursor.phase : 'viewer') as LinearPhase;
  const nextPhase = (p: LinearPhase): Record<string, unknown> => {
    const i = LINEAR_PHASES.indexOf(p);
    return { phase: LINEAR_PHASES[i + 1] ?? 'done', after: null };
  };

  if (phase === 'viewer') {
    const data = await linearGraphql<{ viewer: { email: string }; organization: { name: string; urlKey: string } }>(token, LINEAR_QUERIES.viewer, {});
    return {
      items: [{ kind: 'org', data: { name: data.organization?.name ?? '', urlKey: data.organization?.urlKey ?? '' } }],
      cursor: nextPhase('viewer'),
      done: false,
      stage: 'read:viewer',
    };
  }

  const after = typeof cursor.after === 'string' ? cursor.after : null;
  const data = await linearGraphql<Record<string, { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] }>>(
    token,
    LINEAR_QUERIES[phase],
    { after },
  );
  const page = data[ROOT_FIELD[phase]];
  if (!page) throw new ImportError('source_error');
  const items = page.nodes.flatMap((n) => nodeToItems(phase, n));
  const more = page.pageInfo.hasNextPage && !!page.pageInfo.endCursor;
  const cursorNext = more ? { phase, after: page.pageInfo.endCursor } : nextPhase(phase);
  return { items, cursor: cursorNext, done: !more && phase === 'relations', stage: `read:${phase}` };
}
