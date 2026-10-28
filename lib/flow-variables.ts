/**
 * Flow — variables ({{vars.clave}}). Cada persona define las suyas y las
 * leen todos los flows que corren con su acceso (los que creó o cuyo grafo
 * cambió por última vez). No son de todo el workspace a propósito: un flow
 * corre con el acceso de su dueño (Gmail, Docs, CRM), y si otra persona
 * pudiera cambiar un valor que ese flow usa (un destinatario, una URL),
 * podría desviar sus datos sin tocar el grafo. Para secretos están las
 * credenciales (cifradas); las variables son texto visible. Server-only.
 */
import { getDb, type FlowVariableRow } from './db';
import { nowIso } from './flow';

export const MAX_FLOW_VARIABLES = 100;
export const MAX_VARIABLE_VALUE = 10_000;
export const VARIABLE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export interface FlowVariableDto {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
}

function toDto(r: FlowVariableRow): FlowVariableDto {
  return { id: r.id, key: r.key, value: r.value, updatedAt: r.updated_at };
}

/** Variables de una persona en el workspace (ordenadas por clave). */
export async function listVariables(workspaceId: string, personId: string): Promise<FlowVariableDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM flow_variables WHERE user_id = ? AND person_id = ? ORDER BY key COLLATE NOCASE')
    .all(workspaceId, personId)) as FlowVariableRow[];
  return rows.map(toDto);
}

/** { clave: valor } para el contexto de una corrida ({{vars.x}}); vacío sin persona. */
export async function variablesFor(workspaceId: string, personId: string | null): Promise<Record<string, string>> {
  if (!personId) return {};
  const out: Record<string, string> = {};
  for (const v of await listVariables(workspaceId, personId)) out[v.key] = v.value;
  return out;
}

export type VariableResult =
  | { ok: true; variable: FlowVariableDto }
  | { ok: false; error: 'invalid_key' | 'value_too_long' | 'duplicate_key' | 'too_many_variables' | 'not_found' };

function check(key: string, value: string): 'invalid_key' | 'value_too_long' | null {
  if (!VARIABLE_KEY_RE.test(key)) return 'invalid_key';
  if (value.length > MAX_VARIABLE_VALUE) return 'value_too_long';
  return null;
}

export async function createVariable(workspaceId: string, personId: string, key: string, value: string): Promise<VariableResult> {
  const k = key.trim();
  const bad = check(k, value);
  if (bad) return { ok: false, error: bad };
  const db = getDb();
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM flow_variables WHERE user_id = ? AND person_id = ?').get(workspaceId, personId)) as {
    n: number;
  };
  if (Number(n.n) >= MAX_FLOW_VARIABLES) return { ok: false, error: 'too_many_variables' };
  const id = crypto.randomUUID();
  const ts = nowIso();
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO flow_variables (id, user_id, person_id, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, personId, k, value, ts, ts);
  if (res.changes === 0) return { ok: false, error: 'duplicate_key' };
  return { ok: true, variable: { id, key: k, value, updatedAt: ts } };
}

/** Cambia clave o valor de una variable propia (nunca la de otra persona). */
export async function updateVariable(
  workspaceId: string,
  personId: string,
  id: string,
  patch: { key?: string; value?: string },
): Promise<VariableResult> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT * FROM flow_variables WHERE id = ? AND user_id = ? AND person_id = ?')
    .get(id, workspaceId, personId)) as FlowVariableRow | undefined;
  if (!row) return { ok: false, error: 'not_found' };
  const key = patch.key === undefined ? row.key : patch.key.trim();
  const value = patch.value ?? row.value;
  const bad = check(key, value);
  if (bad) return { ok: false, error: bad };
  if (key !== row.key) {
    const dup = await db
      .prepare('SELECT 1 FROM flow_variables WHERE user_id = ? AND person_id = ? AND key = ? AND id != ?')
      .get(workspaceId, personId, key, id);
    if (dup) return { ok: false, error: 'duplicate_key' };
  }
  const ts = nowIso();
  await db
    .prepare('UPDATE flow_variables SET key = ?, value = ?, updated_at = ? WHERE id = ? AND user_id = ? AND person_id = ?')
    .run(key, value, ts, id, workspaceId, personId);
  return { ok: true, variable: { id, key, value, updatedAt: ts } };
}

export async function deleteVariable(workspaceId: string, personId: string, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM flow_variables WHERE id = ? AND user_id = ? AND person_id = ?')
    .run(id, workspaceId, personId);
  return res.changes > 0;
}
