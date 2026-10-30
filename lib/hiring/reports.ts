/**
 * Hiring: reportes sobre las postulaciones que la persona ve. Tiempo hasta
 * contratar, conversión por etapa, efectividad de cada fuente y puestos
 * abiertos. Server-only.
 */
import { getDb } from '../db';
import { STAGE_KINDS, type HiringActor, type StageKind } from './types';
import { listStages, parseJson, visibleAppsSql } from './core';

export interface HiringReport {
  days: number;
  jobId: string | null;
  timeToHire: { hires: number; avgDays: number | null; medianDays: number | null };
  funnel: Array<{ key: string; label: string; reached: number; rate: number | null }>;
  sources: Array<{ source: string; applications: number; interviews: number; hires: number }>;
  openJobs: Array<{ id: string; title: string; daysOpen: number; active: number; total: number }>;
}

const dayMs = 86_400_000;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function hiringReport(actor: HiringActor, opts: { days?: number; jobId?: string | null; kindLabels?: Record<string, string> } = {}): Promise<HiringReport> {
  const days = [30, 90, 180, 365].includes(Number(opts.days)) ? Number(opts.days) : 90;
  const since = new Date(Date.now() - days * dayMs).toISOString();
  const vis = visibleAppsSql(actor);
  const db = getDb();
  const jobFilter = opts.jobId ? ' AND a.job_id = ?' : '';
  const apps = (await db
    .prepare(
      `SELECT a.id, a.job_id, a.source, a.status, a.created_at, a.hired_at, s.kind AS stage_kind, s.position AS stage_pos, a.stage_id
       FROM hiring_applications a LEFT JOIN hiring_stages s ON s.id = a.stage_id
       WHERE ${vis.sql}${jobFilter} AND a.created_at >= ?`,
    )
    .all(...vis.args, ...(opts.jobId ? [opts.jobId] : []), since)) as Array<{
    id: string;
    job_id: string;
    source: string;
    status: string;
    created_at: string;
    hired_at: string | null;
    stage_kind: StageKind | null;
    stage_pos: number | null;
    stage_id: string;
  }>;

  // Etapas alcanzadas: la actual y todas por las que pasó (eventos "stage").
  const reachedKind = new Map<string, number>();
  const reachedStage = new Map<string, Set<string>>();
  const ids = apps.map((a) => a.id);
  const moves: Array<{ application_id: string; data: string }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (!chunk.length) break;
    moves.push(
      ...((await db
        .prepare(`SELECT application_id, data FROM hiring_events WHERE kind = 'stage' AND application_id IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk)) as Array<{ application_id: string; data: string }>),
    );
  }
  for (const a of apps) {
    reachedKind.set(a.id, STAGE_KINDS.indexOf(a.stage_kind ?? 'applied'));
    reachedStage.set(a.id, new Set([a.stage_id]));
  }
  for (const m of moves) {
    const d = parseJson<{ toKind?: StageKind; to?: string }>(m.data, {});
    if (d.toKind) reachedKind.set(m.application_id, Math.max(reachedKind.get(m.application_id) ?? 0, STAGE_KINDS.indexOf(d.toKind)));
    if (d.to) reachedStage.get(m.application_id)?.add(`name:${d.to}`);
  }

  let funnel: HiringReport['funnel'];
  if (opts.jobId) {
    // Por etapa del puesto (posición): alcanzó la etapa si su máxima posición la supera.
    const stages = await listStages(opts.jobId);
    const posOf = new Map(stages.map((s) => [s.id, s.position]));
    const nameToPos = new Map(stages.map((s) => [`name:${s.name}`, s.position]));
    const maxPos = new Map<string, number>();
    for (const a of apps) {
      let best = posOf.get(a.stage_id) ?? 0;
      for (const k of reachedStage.get(a.id) ?? []) best = Math.max(best, nameToPos.get(k) ?? posOf.get(k) ?? 0);
      maxPos.set(a.id, best);
    }
    funnel = stages.map((s) => ({ key: s.id, label: s.name, reached: apps.filter((a) => (maxPos.get(a.id) ?? 0) >= s.position).length, rate: null }));
  } else {
    funnel = STAGE_KINDS.map((k, i) => ({ key: k, label: opts.kindLabels?.[k] ?? k, reached: apps.filter((a) => (reachedKind.get(a.id) ?? 0) >= i).length, rate: null }));
  }
  funnel = funnel.map((f, i) => ({ ...f, rate: i === 0 || !funnel[i - 1].reached ? null : Math.round((f.reached / funnel[i - 1].reached) * 100) }));

  const hireDays = apps.filter((a) => a.hired_at).map((a) => (Date.parse(a.hired_at!) - Date.parse(a.created_at)) / dayMs);
  const bySource = new Map<string, { applications: number; interviews: number; hires: number }>();
  const interviewIdx = STAGE_KINDS.indexOf('interview');
  for (const a of apps) {
    const s = bySource.get(a.source) ?? { applications: 0, interviews: 0, hires: 0 };
    s.applications++;
    if ((reachedKind.get(a.id) ?? 0) >= interviewIdx) s.interviews++;
    if (a.status === 'hired') s.hires++;
    bySource.set(a.source, s);
  }

  const open = (await db
    .prepare(
      `SELECT j.id, j.title, j.published_at, j.created_at,
              (SELECT COUNT(*) FROM hiring_applications a WHERE a.job_id = j.id AND a.status = 'active' AND ${vis.sql}) AS active,
              (SELECT COUNT(*) FROM hiring_applications a WHERE a.job_id = j.id AND ${vis.sql}) AS total
       FROM hiring_jobs j WHERE j.workspace_id = ? AND j.status = 'published' ORDER BY j.published_at`,
    )
    .all(...vis.args, ...vis.args, actor.ws)) as Array<{ id: string; title: string; published_at: string | null; created_at: string; active: number; total: number }>;

  return {
    days,
    jobId: opts.jobId ?? null,
    timeToHire: {
      hires: hireDays.length,
      avgDays: hireDays.length ? round1(hireDays.reduce((s, d) => s + d, 0) / hireDays.length) : null,
      medianDays: hireDays.length ? round1(median(hireDays)!) : null,
    },
    funnel,
    sources: [...bySource.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.applications - a.applications),
    openJobs: open.map((j) => ({ id: j.id, title: j.title, daysOpen: Math.max(0, Math.floor((Date.now() - Date.parse(j.published_at ?? j.created_at)) / dayMs)), active: Number(j.active), total: Number(j.total) })),
  };
}
