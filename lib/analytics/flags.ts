/**
 * /decide: los flags activos de un proyecto (caché de 15 s por instancia) y
 * su valor para un distinct_id con las propiedades de su persona. Server-only.
 */
import { getDb } from '../db';
import { evaluateFlag, type EvaluableFlag } from './flags-core';

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; flags: EvaluableFlag[] }>();

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

export async function projectFlags(projectId: string): Promise<EvaluableFlag[]> {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.flags;
  const rows = (await getDb()
    .prepare('SELECT key, active, rollout, variants, conditions FROM analytics_flags WHERE project_id = ? AND active = 1')
    .all(projectId)) as Array<{ key: string; active: number; rollout: number; variants: string; conditions: string }>;
  const flags = rows.map((r) => ({
    key: r.key,
    active: Number(r.active) === 1,
    rollout: Number(r.rollout),
    variants: parse(r.variants, []),
    conditions: parse(r.conditions, []),
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
  const flags = await projectFlags(projectId);
  if (!flags.length) return {};
  const needsProps = flags.some((f) => f.conditions.length > 0);
  const props = needsProps ? { ...(await personPropsFor(projectId, distinctId)), ...overrides } : overrides;
  const out: Record<string, boolean | string> = {};
  for (const f of flags) out[f.key] = evaluateFlag(f, distinctId, props);
  return out;
}
