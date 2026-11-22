/**
 * CRM — mover un deal de etapa desde la app o la API, completando en el
 * mismo paso las propiedades que pide la etapa. Server-only.
 */
import { getDb, type CrmDealRow } from './db';
import { listCustomFields, moveDeal, parseCustom, updateDeal, type MoveDealResult } from './crm';
import { coerceCustomFieldValue, fieldOptions } from './crm-custom-fields';
import type { CrmCustomFieldType } from './schema/types';
import type { DealMovePayload } from './crm-schema';

export interface MissingFieldInfo {
  key: string;
  /** Tipo del input: estándar (amount, closeDate…) o el del custom field. */
  type: 'amount' | 'closeDate' | 'ownerId' | 'priority' | 'source' | 'description' | 'company' | 'contacts' | CrmCustomFieldType;
  /** Solo custom fields (los estándar los traduce la UI). */
  label?: string;
  options?: string[];
  /** Owner y custom fields de persona: personas del workspace. */
  choices?: Array<{ value: string; label: string }>;
  currency?: string;
}

/**
 * Lo que pide la etapa, separado según la persona: `fillable` lo que puede
 * completar en el diálogo; `adminRequired` si falta además un campo propio
 * que tiene oculto o de solo lectura (lo tiene que completar un admin). Los
 * ocultos no se nombran. Puro.
 */
export function splitMissingForViewer(
  missing: string[],
  restricted: ReadonlyMap<string, 'read' | 'hidden'>,
): { fillable: string[]; adminRequired: boolean } {
  const fillable: string[] = [];
  let adminRequired = false;
  for (const key of missing) {
    if (key.startsWith('custom:') && restricted.has(key.slice(7))) adminRequired = true;
    else fillable.push(key);
  }
  return { fillable, adminRequired };
}

/** Lo que queda en lugar de los campos ocultos en `required_fields`: la etapa sigue pidiendo algo, sin nombrarlo. */
export const PRIVATE_REQUIRED_KEY = 'custom:_private';

/**
 * `required_fields` (JSON) de una etapa como lo ve la persona: los campos
 * propios que tiene ocultos se cambian por PRIVATE_REQUIRED_KEY (una vez). Puro.
 */
export function redactRequiredFields(json: string | null | undefined, hidden: ReadonlySet<string>): string {
  if (!json || !hidden.size) return json ?? '[]';
  let keys: unknown;
  try {
    keys = JSON.parse(json);
  } catch {
    return '[]';
  }
  if (!Array.isArray(keys)) return '[]';
  const out: string[] = [];
  let hid = false;
  for (const k of keys) {
    if (typeof k !== 'string') continue;
    if (k.startsWith('custom:') && hidden.has(k.slice(7))) hid = true;
    else out.push(k);
  }
  if (hid) out.push(PRIVATE_REQUIRED_KEY);
  return JSON.stringify(out);
}

/** Etapas (o pipelines con sus etapas) sin nombrar en `required_fields` campos que la persona tiene ocultos. */
export function redactStagesFor<S extends { required_fields: string }>(stages: S[], hidden: ReadonlySet<string>): S[] {
  if (!hidden.size) return stages;
  return stages.map((st) => ({ ...st, required_fields: redactRequiredFields(st.required_fields, hidden) }));
}

/** Cómo pedir cada propiedad que falta (la UI arma el diálogo con esto). */
export async function describeMissing(
  userId: string,
  missing: string[],
  people: Array<{ value: string; label: string }> = [],
): Promise<MissingFieldInfo[]> {
  const defs = missing.some((k) => k.startsWith('custom:')) ? await listCustomFields(userId, 'deals') : [];
  return missing.map((key): MissingFieldInfo => {
    if (key === 'ownerId') return { key, type: 'ownerId', choices: people };
    if (!key.startsWith('custom:')) return { key, type: key as MissingFieldInfo['type'] };
    const def = defs.find((d) => `custom:${d.name}` === key);
    if (!def) return { key, type: 'text', label: key.slice(7) };
    return {
      key,
      type: def.type,
      label: def.label,
      ...(def.type === 'select' || def.type === 'multiselect' ? { options: fieldOptions(def) } : {}),
      ...(def.type === 'currency' ? { currency: fieldOptions(def)[0] ?? 'USD' } : {}),
      ...(def.type === 'user' ? { choices: people } : {}),
    };
  });
}

/**
 * Guarda `fields` (si vinieron) y mueve el deal. Los custom fields se suman a
 * los del deal: el PATCH normal reemplaza el JSON entero.
 */
export async function moveDealWithFields(
  userId: string,
  dealId: string,
  payload: Pick<DealMovePayload, 'stageId' | 'beforeId' | 'lostReason' | 'fields'>,
  actorEmail: string,
  actorId: string | null = null,
): Promise<MoveDealResult> {
  const f = payload.fields;
  if (f && Object.keys(f).length) {
    const row = (await getDb().prepare('SELECT * FROM crm_deals WHERE id = ? AND user_id = ?').get(dealId, userId)) as
      | CrmDealRow
      | undefined;
    if (!row) return { ok: false, reason: 'not_found' };
    const { custom, ...rest } = f;
    let merged: Record<string, unknown> | undefined;
    if (custom && Object.keys(custom).length) {
      // Cada valor se valida contra su campo (como en la edición en masa); lo inválido se ignora.
      const defs = await listCustomFields(userId, 'deals');
      merged = parseCustom(row.custom);
      for (const [name, value] of Object.entries(custom)) {
        const def = defs.find((d) => d.name === name);
        const v = def ? coerceCustomFieldValue(def, value) : undefined;
        if (v !== undefined) merged[name] = v;
      }
    }
    await updateDeal(userId, dealId, { ...rest, ...(merged ? { custom: merged } : {}) }, actorEmail);
  }
  return moveDeal(userId, dealId, payload.stageId, payload.beforeId ?? null, payload.lostReason, actorEmail, { actorId });
}
