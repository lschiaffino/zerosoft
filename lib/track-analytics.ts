/**
 * Track, analítica con el kit (el formato de Lines): issues creados y
 * terminados, tiempo de ciclo y abiertos de los equipos que la persona ve, en
 * un período contra el anterior (días y horas en la zona de quien mira).
 * Los issues salen del mismo lector que Insights (lib/track-insights): el
 * inicio es el primer paso a "in progress" y el fin, el último cierre como done.
 */
import { loadInsightIssues } from './track-insights';
import type { InsightIssue } from './track-planning-core';
import type { WorkspaceScope } from './track-plans';
import { analyticsRange, daySeries, localDay, median, rangeInfo, sumOf, tzOffsetSec, type AnalyticsRange, type Kpi, type RangeInfo, type RangeInput } from './analytics-kit/period';
import { shortCache } from './analytics-kit/cache';

export interface TrackDay {
  day: string;
  created: number;
  completed: number;
}

export interface TrackGroupStat {
  id: string;
  name: string;
  created: number;
  completed: number;
  open: number;
  /** Mediana de inicio a fin, en minutos, de lo terminado en el período. */
  cycleMin: number | null;
  prevCompleted: number;
}

export interface TrackAnalytics {
  range: RangeInfo;
  kpis: { created: Kpi; completed: Kpi; cycleMin: Kpi; leadMin: Kpi; open: Kpi };
  perDay: TrackDay[];
  teams: TrackGroupStat[];
  people: TrackGroupStat[];
  /** Issues terminados por día de la semana (0 = lunes) y hora local. */
  heat: number[][];
  teamList: Array<{ id: string; name: string }>;
  issueCount: number;
}

const OPEN = new Set<string>(['backlog', 'todo', 'in_progress']);
const isOpen = (i: InsightIssue) => i.category == null || OPEN.has(i.category);

/** Agrega los issues leídos (puro: lo prueban los tests). */
export function aggregateTrack(range: AnalyticsRange, issues: InsightIssue[], teamId?: string): TrackAnalytics {
  const since = Date.parse(range.since);
  const until = Date.parse(range.until);
  const prevSince = Date.parse(range.prevSince);
  const teamList = [...new Map(issues.map((i) => [i.projectId, { id: i.projectId, name: i.projectName }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const list = teamId ? issues.filter((i) => i.projectId === teamId) : issues;
  const byDay = new Map<string, Omit<TrackDay, 'day'>>();
  const bump = (ms: number, k: 'created' | 'completed') => {
    const day = localDay(ms, range.tz);
    const v = byDay.get(day) ?? { created: 0, completed: 0 };
    v[k] += 1;
    byDay.set(day, v);
  };
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const cycles = { cur: [] as number[], prev: [] as number[] };
  const leads = { cur: [] as number[], prev: [] as number[] };
  const groups = { teams: new Map<string, TrackGroupStat & { cycles: number[] }>(), people: new Map<string, TrackGroupStat & { cycles: number[] }>() };
  const group = (m: Map<string, TrackGroupStat & { cycles: number[] }>, id: string, name: string) => {
    let g = m.get(id);
    if (!g) m.set(id, (g = { id, name, created: 0, completed: 0, open: 0, cycleMin: null, prevCompleted: 0, cycles: [] }));
    return g;
  };
  let open = 0;
  for (const i of list) {
    const team = group(groups.teams, i.projectId, i.projectName);
    const person = group(groups.people, i.assigneeId ?? '', i.assigneeName ?? '');
    if (isOpen(i)) {
      open += 1;
      team.open += 1;
      person.open += 1;
    }
    const created = Date.parse(i.createdAt);
    if (created >= prevSince && created < until) {
      bump(created, 'created');
      if (created >= since) {
        team.created += 1;
        person.created += 1;
      }
    }
    const done = i.completedAt ? Date.parse(i.completedAt) : NaN;
    if (!Number.isFinite(done) || done < prevSince || done >= until) continue;
    bump(done, 'completed');
    const cur = done >= since;
    const started = i.startedAt ? Date.parse(i.startedAt) : NaN;
    const cycle = Number.isFinite(started) && started <= done ? Math.round((done - started) / 60_000) : null;
    const lead = Number.isFinite(created) && created <= done ? Math.round((done - created) / 60_000) : null;
    if (cycle != null) (cur ? cycles.cur : cycles.prev).push(cycle);
    if (lead != null) (cur ? leads.cur : leads.prev).push(lead);
    if (!cur) {
      team.prevCompleted += 1;
      person.prevCompleted += 1;
      continue;
    }
    team.completed += 1;
    person.completed += 1;
    if (cycle != null) {
      team.cycles.push(cycle);
      person.cycles.push(cycle);
    }
    const local = new Date(done + tzOffsetSec(done, range.tz) * 1000);
    heat[(local.getUTCDay() + 6) % 7][local.getUTCHours()] += 1;
  }
  const { cur: perDay, prev } = daySeries(range, byDay, () => ({ created: 0, completed: 0 }));
  const out = (m: Map<string, TrackGroupStat & { cycles: number[] }>) =>
    [...m.values()]
      .filter((g) => g.created + g.completed + g.prevCompleted + g.open > 0)
      .map(({ cycles: c, ...g }) => ({ ...g, cycleMin: median(c) }))
      .sort((a, b) => b.completed - a.completed || b.created - a.created || b.open - a.open || a.name.localeCompare(b.name));
  return {
    range: rangeInfo(range),
    kpis: {
      created: { value: sumOf(perDay, (p) => p.created), prev: sumOf(prev, (p) => p.created) },
      completed: { value: sumOf(perDay, (p) => p.completed), prev: sumOf(prev, (p) => p.completed) },
      cycleMin: { value: median(cycles.cur), prev: median(cycles.prev) },
      leadMin: { value: median(leads.cur), prev: median(leads.prev) },
      open: { value: open },
    },
    perDay,
    teams: out(groups.teams),
    people: out(groups.people),
    heat,
    teamList,
    issueCount: issues.length,
  };
}

/** La analítica de Track de los equipos que ve quien mira (o de uno). */
export async function trackAnalytics(scope: WorkspaceScope, teamId: string | undefined, query: RangeInput = {}, now = new Date()): Promise<TrackAnalytics> {
  const range = analyticsRange(query, now);
  const issues = await loadInsightIssues(scope, {});
  return aggregateTrack(range, issues, teamId);
}

export function isTrackAnalyticsEmpty(d: TrackAnalytics): boolean {
  const k = d.kpis;
  return d.issueCount === 0 || !(k.created.value || k.completed.value || k.created.prev || k.completed.prev || k.open.value);
}

const cache = shortCache<TrackAnalytics>();

/** Con la caché corta del kit. La clave lleva el workspace, quién mira (ve otros proyectos), el equipo y el rango. */
export function cachedTrackAnalytics(scope: WorkspaceScope, viewerId: string, teamId: string | undefined, query: RangeInput = {}): Promise<TrackAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return cache.get(JSON.stringify([scope.teamId, scope.ownerId, viewerId, teamId ?? '', r.since, r.until, r.tz]), () => trackAnalytics(scope, teamId, query, now));
}

export function clearTrackAnalyticsCache(): void {
  cache.clear();
}
