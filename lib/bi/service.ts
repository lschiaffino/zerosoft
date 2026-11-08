/**
 * Correr preguntas guardadas, con los filtros de un tablero aplicados.
 * Server-only.
 */
import { personAppAccess } from '../api-auth';
import { viewerCan, type BiViewer } from './access';
import { runQuery, RunError } from './run';
import { getQuestion, type DashboardDto, type QuestionDto } from './store';
import type { BiQuery, BiResult, DashFilter } from './types';

/** Valor de un filtro de fecha: last_7, last_30… → días. */
export function lastDays(v: string): number | null {
  const m = /^last_(\d{1,4})$/.exec(v);
  return m ? Number(m[1]) : null;
}

/** La consulta de la pregunta con los filtros del tablero que le tocan. */
export function withDashFilters(
  q: QuestionDto,
  mapping: Record<string, { param?: string; column?: string }>,
  filters: DashFilter[],
  values: Record<string, string>,
): { query: BiQuery; values: Record<string, string> } {
  const out: Record<string, string> = {};
  let query = q.query;
  for (const f of filters) {
    const v = values[f.id] ?? f.default;
    const map = mapping[f.id];
    if (!v || !map) continue;
    if (query.kind === 'sql' && map.param) out[map.param] = v;
    if (query.kind === 'builder' && map.column) {
      const days = f.type === 'date' ? lastDays(v) : null;
      if (f.type === 'date' && !days) continue;
      query = { ...query, filters: [...query.filters, days ? { column: map.column, op: 'last_days' as const, value: days } : { column: map.column, op: '=' as const, value: v }] };
    }
  }
  return { query, values: out };
}

export async function runSavedQuestion(
  viewer: BiViewer,
  id: string,
  opts: { values?: Record<string, string>; fresh?: boolean; dashboard?: DashboardDto; cardId?: string } = {},
): Promise<{ question: QuestionDto; result: BiResult }> {
  const q = await getQuestion(viewer, id);
  if (!q) throw new RunError('not_found', undefined, 404);
  let query = q.query;
  let values = opts.values ?? {};
  if (opts.dashboard && opts.cardId) {
    const card = opts.dashboard.cards.find((c) => c.id === opts.cardId && c.questionId === id);
    if (!card) throw new RunError('not_found', undefined, 404);
    const applied = withDashFilters(q, card.mapping, opts.dashboard.filters, values);
    query = applied.query;
    values = applied.values;
  }
  const result = await runQuery(viewer, q.source, query, { values, fresh: opts.fresh });
  return { question: q, result };
}

/**
 * Quien creó un link o una suscripción, con su acceso de hoy: si dejó el
 * workspace o perdió Analytics, lo compartido deja de responder.
 */
export async function ownerViewer(workspaceId: string, personId: string): Promise<BiViewer | null> {
  const access = await personAppAccess(workspaceId, personId);
  if (!access) return null;
  const viewer: BiViewer = { workspaceId, personId, role: access.role, apps: access.apps };
  return viewerCan(viewer, 'analytics') ? viewer : null;
}

/** Pregunta de un link público (ya validado), corrida como quien lo creó. */
export async function runSharedQuestion(viewer: BiViewer, questionId: string, values: Record<string, string>, dashboard?: DashboardDto, cardId?: string): Promise<{ question: QuestionDto; result: BiResult } | { question: QuestionDto; error: string }> {
  const q = await getQuestion(viewer, questionId);
  if (!q) throw new RunError('not_found', undefined, 404);
  let query = q.query;
  let vals = values;
  if (dashboard && cardId) {
    const card = dashboard.cards.find((c) => c.id === cardId);
    const applied = withDashFilters(q, card?.mapping ?? {}, dashboard.filters, values);
    query = applied.query;
    vals = applied.values;
  }
  try {
    return { question: q, result: await runQuery(viewer, q.source, query, { values: vals }) };
  } catch (err) {
    return { question: q, error: err instanceof RunError ? err.code : 'query_failed' };
  }
}
