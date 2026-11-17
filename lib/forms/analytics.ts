/**
 * Forms, analítica con el kit (el formato de Lines): visitas, respuestas,
 * tasa de finalización y respuestas a medias de los formularios que la
 * persona ve, en un período contra el anterior (días y horas en la zona de
 * quien mira). Las visitas las anota el formulario público
 * (lib/forms/responses.ts, se guardan 180 días); acá solo se agregan.
 */
import { getDb } from '../db';
import { visibleSql } from './core';
import type { FormsActor } from './types';
import {
  analyticsRange,
  dayIndexSql,
  daySeries,
  hourSql,
  idxDay,
  num,
  rangeInfo,
  rangeSegments,
  sumOf,
  weekdaySql,
  type AnalyticsRange,
  type Kpi,
  type RangeInfo,
  type RangeInput,
} from '../analytics-kit/period';
import { shortCache } from '../analytics-kit/cache';

export interface FormsDay {
  day: string;
  views: number;
  responses: number;
  partial: number;
}

export interface FormsFormStat {
  id: string;
  name: string;
  status: string;
  views: number;
  responses: number;
  /** Visitas que terminaron (la tasa sale de acá, no de respuestas / visitas: una respuesta por API no tiene visita). */
  completedViews: number;
  partial: number;
  prevResponses: number;
}

export interface FormsAnalytics {
  range: RangeInfo;
  kpis: { views: Kpi; responses: Kpi; completion: Kpi; partial: Kpi };
  perDay: FormsDay[];
  forms: FormsFormStat[];
  /** Respuestas por día de la semana (0 = lunes) y hora local. */
  heat: number[][];
  /** Cuántos formularios ve la persona (sin formularios, el vacío invita a crear uno). */
  formCount: number;
  /** Los formularios que ve (para el filtro). */
  formList: Array<{ id: string; name: string }>;
}

/** Una fila agregada por formulario, día y período (cur = 1 el elegido). */
export interface FormsFact {
  form_id: string;
  cur: number;
  day: number;
  kind: 'view' | 'done' | 'response' | 'partial';
  n: number;
}

type Arg = string | number;

/** Agrega las filas leídas (puro: lo prueban los tests). */
export function aggregateForms(
  range: AnalyticsRange,
  forms: Array<{ id: string; name: string; status: string }>,
  facts: FormsFact[],
  heatRows: Array<{ wd: number; hr: number; n: number }>,
): FormsAnalytics {
  const empty = (): Omit<FormsDay, 'day'> => ({ views: 0, responses: 0, partial: 0 });
  const byDay = new Map<string, Omit<FormsDay, 'day'>>();
  const stats = new Map<string, FormsFormStat>(forms.map((f) => [f.id, { id: f.id, name: f.name, status: f.status, views: 0, responses: 0, completedViews: 0, partial: 0, prevResponses: 0 }]));
  const done = { cur: 0, prev: 0 };
  for (const r of facts) {
    const n = num(r.n);
    const cur = num(r.cur) === 1;
    const s = stats.get(r.form_id);
    if (r.kind === 'done') {
      if (cur) done.cur += n;
      else done.prev += n;
      if (cur && s) s.completedViews += n;
      continue;
    }
    const day = idxDay(r.day);
    let v = byDay.get(day);
    if (!v) byDay.set(day, (v = empty()));
    if (r.kind === 'view') v.views += n;
    else if (r.kind === 'response') v.responses += n;
    else v.partial += n;
    if (!s) continue;
    if (!cur) {
      if (r.kind === 'response') s.prevResponses += n;
      continue;
    }
    if (r.kind === 'view') s.views += n;
    else if (r.kind === 'response') s.responses += n;
    else s.partial += n;
  }
  const { cur: perDay, prev } = daySeries(range, byDay, empty);
  const views = sumOf(perDay, (p) => p.views);
  const prevViews = sumOf(prev, (p) => p.views);
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const h of heatRows) {
    const wd = num(h.wd);
    const hr = num(h.hr);
    if (wd >= 0 && wd < 7 && hr >= 0 && hr < 24) heat[wd][hr] += num(h.n);
  }
  return {
    range: rangeInfo(range),
    kpis: {
      views: { value: views, prev: prevViews },
      responses: { value: sumOf(perDay, (p) => p.responses), prev: sumOf(prev, (p) => p.responses) },
      completion: { value: views ? Math.min(1, done.cur / views) : null, prev: prevViews ? Math.min(1, done.prev / prevViews) : null },
      partial: { value: sumOf(perDay, (p) => p.partial), prev: sumOf(prev, (p) => p.partial) },
    },
    perDay,
    forms: [...stats.values()]
      .filter((f) => f.views + f.responses + f.partial + f.prevResponses > 0)
      .sort((a, b) => b.responses - a.responses || b.views - a.views || a.name.localeCompare(b.name)),
    heat,
    formCount: forms.length,
    formList: forms.map((f) => ({ id: f.id, name: f.name })),
  };
}

const SEC = (col: string) => `CAST(strftime('%s', ${col}) AS INTEGER)`;

/** La analítica de Forms de los formularios que ve la persona (o de uno, si lo ve). */
export async function formsAnalytics(actor: FormsActor, formId: string | undefined, query: RangeInput = {}, now = new Date()): Promise<FormsAnalytics> {
  const range = analyticsRange(query, now);
  const vis = visibleSql(actor);
  const db = getDb();
  let forms = (await db.prepare(`SELECT f.id, f.name, f.status FROM forms_forms f WHERE ${vis.sql} ORDER BY f.name`).all(...vis.args)) as Array<{ id: string; name: string; status: string }>;
  const formCount = forms.length;
  const formList = forms.map((f) => ({ id: f.id, name: f.name }));
  if (formId) forms = forms.filter((f) => f.id === formId);
  if (!forms.length) return { ...aggregateForms(range, [], [], []), formCount, formList };
  const ids = forms.map((f) => f.id);
  const marks = ids.map(() => '?').join(',');
  const segs = rangeSegments(range);
  const span: Arg[] = [range.prevSince, range.until];
  const grouped = (table: string, col: string, kind: FormsFact['kind'], extra = '') => {
    const day = dayIndexSql(segs, SEC(col));
    return {
      sql: `SELECT form_id, CASE WHEN ${col} >= ? THEN 1 ELSE 0 END AS cur, ${day} AS day, '${kind}' AS kind, COUNT(*) AS n
            FROM ${table} WHERE form_id IN (${marks}) AND ${col} >= ? AND ${col} < ?${extra} GROUP BY form_id, cur, day`,
      args: [range.since, ...ids, ...span] as Arg[],
    };
  };
  const parts = [
    grouped('forms_visits', 'created_at', 'view'),
    grouped('forms_responses', 'submitted_at', 'response', " AND status = 'completed'"),
    grouped('forms_responses', 'created_at', 'partial', " AND status = 'partial'"),
  ];
  const doneSql = `SELECT form_id, CASE WHEN created_at >= ? THEN 1 ELSE 0 END AS cur, 0 AS day, 'done' AS kind, COUNT(*) AS n
                   FROM forms_visits WHERE form_id IN (${marks}) AND created_at >= ? AND created_at < ? AND completed = 1 GROUP BY form_id, cur`;
  const secR = SEC('submitted_at');
  const [facts, heatRows] = await Promise.all([
    db
      .prepare([...parts.map((p) => p.sql), doneSql].join(' UNION ALL '))
      .all(...parts.flatMap((p) => p.args), range.since, ...ids, ...span) as Promise<FormsFact[]>,
    db
      .prepare(
        `SELECT ${weekdaySql(dayIndexSql(segs, secR))} AS wd, ${hourSql(segs, secR)} AS hr, COUNT(*) AS n
         FROM forms_responses WHERE form_id IN (${marks}) AND status = 'completed' AND submitted_at >= ? AND submitted_at < ? GROUP BY wd, hr`,
      )
      .all(...ids, range.since, range.until) as Promise<Array<{ wd: number; hr: number; n: number }>>,
  ]);
  return { ...aggregateForms(range, forms, facts, heatRows), formCount, formList };
}

export function isFormsAnalyticsEmpty(d: FormsAnalytics): boolean {
  const k = d.kpis;
  return d.formCount === 0 || !(k.views.value || k.responses.value || k.partial.value || k.views.prev || k.responses.prev);
}

const cache = shortCache<FormsAnalytics>();

/** Con la caché corta del kit. La clave lleva quién mira (ve otros formularios), el formulario y el rango. */
export function cachedFormsAnalytics(actor: FormsActor, formId: string | undefined, query: RangeInput = {}): Promise<FormsAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return cache.get(JSON.stringify([actor, formId ?? '', r.since, r.until, r.tz]), () => formsAnalytics(actor, formId, query, now));
}

export function clearFormsAnalyticsCache(): void {
  cache.clear();
}
