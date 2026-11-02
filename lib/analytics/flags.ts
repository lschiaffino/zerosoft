/**
 * /decide: los flags activos de un proyecto (caché de 15 s por instancia) y
 * su valor para un distinct_id con las propiedades de su persona. Server-only.
 */
import { getDb } from '../db';
import { evaluateFlag, type EvaluableFlag } from './flags-core';
import { cohortSql } from './sql-build';
import { cohortDefinitionSchema, type FlagGroup } from './types';

const TTL_MS = 15_000;
type CachedFlag = EvaluableFlag & { payloads: Record<string, string> };
const cache = new Map<string, { at: number; flags: CachedFlag[] }>();

export function forgetFlagsCache(projectId?: string): void {
  if (projectId) cache.delete(projectId);
  else cache.clear();
}

function parse<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw ?? '')) as T;
  } catch {
    return fallback;
  }
}

export async function projectFlags(projectId: string): Promise<CachedFlag[]> {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.flags;
  const rows = (await getDb()
    .prepare('SELECT key, active, rollout, variants, conditions, groups, payloads FROM analytics_flags WHERE project_id = ? AND active = 1')
    .all(projectId)) as Array<{ key: string; active: number; rollout: number; variants: string; conditions: string; groups: string; payloads: string }>;
  const flags = rows.map((r) => ({
    key: r.key,
    active: Number(r.active) === 1,
    rollout: Number(r.rollout),
    variants: parse(r.variants, []),
    conditions: parse(r.conditions, []),
    groups: parse<FlagGroup[]>(r.groups, []),
    payloads: parse<Record<string, string>>(r.payloads, {}),
  }));
  if (cache.size > 2000) cache.clear();
  cache.set(projectId, { at: Date.now(), flags });
  return flags;
}

/** Propiedades guardadas de la persona de un distinct_id ({} si no existe). */
export async function personPropsFor(projectId: string, distinctId: string): Promise<Record<string, unknown>> {
  const row = (await getDb()
    .prepare(
      `SELECT p.properties FROM analytics_person_ids m JOIN analytics_persons p ON p.id = m.person_id
       WHERE m.project_id = ? AND m.distinct_id = ?`,
    )
    .get(projectId, distinctId)) as { properties: string } | undefined;
  const v = parse<unknown>(row?.properties, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Valores de todos los flags activos. `overrides` (person_properties del
 * pedido) se suman a lo guardado: sirve para evaluar antes de que llegue el
 * primer evento con esas propiedades.
 */
export async function decideFlags(projectId: string, distinctId: string, overrides: Record<string, unknown> = {}): Promise<Record<string, boolean | string>> {
  return (await decideFlagsFull(projectId, distinctId, overrides)).flags;
}

/** Cohortes (de las que usan los flags) en las que está este distinct_id. */
async function cohortsOf(projectId: string, distinctId: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ids.length) return out;
  const db = getDb();
  const person = (await db.prepare('SELECT person_id FROM analytics_person_ids WHERE project_id = ? AND distinct_id = ?').get(projectId, distinctId)) as { person_id: string } | undefined;
  const key = person?.person_id ?? distinctId;
  // Tope por pedido: el endpoint es público y cada cohorte es una consulta.
  for (const id of ids.slice(0, 5)) {
    const row = (await db.prepare('SELECT definition FROM analytics_cohorts WHERE id = ? AND project_id = ?').get(id, projectId)) as { definition: string } | undefined;
    if (!row) continue;
    const def = cohortDefinitionSchema.safeParse(parse(row.definition, {}));
    if (!def.success) continue;
    const sub = cohortSql(projectId, def.data, Date.now(), id);
    const hit = await db.prepare(`SELECT 1 AS ok WHERE ? IN (${sub.sql})`).get(key, ...sub.args);
    if (hit) out.add(id);
  }
  return out;
}

/** Valores y payloads de los flags para esta persona. */
export async function decideFlagsFull(
  projectId: string,
  distinctId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ flags: Record<string, boolean | string>; payloads: Record<string, unknown> }> {
  const flags = await projectFlags(projectId);
  if (!flags.length) return { flags: {}, payloads: {} };
  const needsProps = flags.some((f) => f.conditions.length > 0 || f.groups?.some((g) => g.conditions.length > 0));
  const props = needsProps ? { ...(await personPropsFor(projectId, distinctId)), ...overrides } : overrides;
  const cohortIds = [...new Set(flags.flatMap((f) => (f.groups ?? []).map((g) => g.cohortId).filter((x): x is string => Boolean(x))))];
  const cohorts = await cohortsOf(projectId, distinctId, cohortIds);
  const out: Record<string, boolean | string> = {};
  const payloads: Record<string, unknown> = {};
  for (const f of flags) {
    const value = evaluateFlag(f, distinctId, props, cohorts);
    out[f.key] = value;
    if (value === false) continue;
    const raw = f.payloads?.[String(value)];
    if (raw !== undefined) {
      try {
        payloads[f.key] = JSON.parse(raw);
      } catch {
        /* se validó al guardar */
      }
    }
  }
  return { flags: out, payloads };
}
