/**
 * CRM ↔ HubSpot, salida (S3): qué campos de un registro nuestro se mandan a
 * HubSpot y cómo se escribe cada valor allá. Server-only; sin base ni red,
 * para probarlo solo.
 *
 * Los valores se comparan en el mismo texto normalizado que usa la entrada
 * (inbound-map.ts: localValues, mapRecord, el `shadow` del vínculo), así un
 * valor que acabamos de mandar vuelve igual y no se ve como un cambio.
 *
 * La regla, por campo, contra el shadow (lo último que se vio igual de los
 * dos lados):
 * - lo nuestro igual al shadow: no cambió acá, no se manda;
 * - cambió acá y HubSpot sigue igual al shadow: se manda;
 * - cambió acá y HubSpot ya tiene ese mismo valor: no se manda, solo se
 *   corre el shadow;
 * - cambió de los dos lados: no se manda nada de ese campo (queda lo nuestro
 *   acá y lo de HubSpot allá) y se anota el conflicto con el nombre del campo;
 * - un campo sin shadow (el sync nunca lo vio igual) no se manda.
 *
 * Un valor que la propiedad de HubSpot no acepta (una opción que allá no
 * existe, una propiedad de solo lectura o que no está en esa cuenta) no se
 * manda: se anota un código, nunca el valor.
 */
import type { InboundPlan, PlanField, Values } from './inbound-map';
import { same } from './inbound-map';
import type { SyncObject } from './reader';

/** Definición mínima de una propiedad de HubSpot (lo que hace falta para escribirla). */
export interface HsPropDef {
  type: string;
  readOnly: boolean;
  /** Opciones (valor interno y etiqueta) de una enumeración. */
  options?: Array<{ value: string; label: string }>;
}

export type PropDefs = Record<string, HsPropDef>;

/** Campo estándar nuestro → propiedad de HubSpot (la etapa va aparte: dealstage + pipeline). */
export const OUTBOUND_PROPS: Record<SyncObject, Record<string, string>> = {
  contacts: {
    first_name: 'firstname',
    last_name: 'lastname',
    email: 'email',
    phone: 'phone',
    job_title: 'jobtitle',
    website: 'website',
    city: 'city',
    country: 'country',
    lifecycle_stage: 'lifecyclestage',
    lead_status: 'hs_lead_status',
    owner_id: 'hubspot_owner_id',
  },
  companies: {
    name: 'name',
    domain: 'domain',
    industry: 'industry',
    employees: 'numberofemployees',
    phone: 'phone',
    website: 'website',
    city: 'city',
    country: 'country',
    lifecycle_stage: 'lifecyclestage',
    owner_id: 'hubspot_owner_id',
  },
  deals: {
    name: 'dealname',
    stage_id: 'dealstage',
    amount: 'amount',
    currency: 'deal_currency_code',
    close_date: 'closedate',
    description: 'description',
    lost_reason: 'closed_lost_reason',
    owner_id: 'hubspot_owner_id',
  },
};

/** Las propiedades de HubSpot que hace falta conocer para escribir un objeto (sin las propias del plan). */
export function standardProps(object: SyncObject): string[] {
  const out = Object.values(OUTBOUND_PROPS[object]);
  if (object === 'deals') out.push('pipeline');
  return out;
}

/** Lifecycle nuestro → valor interno de HubSpot. */
const LIFECYCLE_OUT: Record<string, string> = {
  subscriber: 'subscriber',
  lead: 'lead',
  mql: 'marketingqualifiedlead',
  sql: 'salesqualifiedlead',
  opportunity: 'opportunity',
  customer: 'customer',
  evangelist: 'evangelist',
};

/** Lo que hace falta del lado nuestro para traducir dueños y etapas. */
export interface OutboundCtx {
  /** Persona del workspace → dueño de HubSpot. */
  owners: Map<string, string>;
  /** Etapa nuestra → etapa y pipeline de HubSpot. */
  stages: Map<string, { stage: string; pipeline: string }>;
  /** Campos propios emparejados (los del plan de la entrada). */
  fields: PlanField[];
  /** Definición de las propiedades de HubSpot de este objeto. */
  defs: PropDefs;
  /**
   * Nombre de las opciones propias del workspace (C2), por propiedad: una
   * opción que no es de fábrica sale con su nombre, y HubSpot la acepta si
   * tiene una con ese nombre (fitProperty compara por nombre); si no, ese campo
   * no se manda (value_not_accepted) y el resto del registro sí.
   */
  optionLabels?: { lifecycle?: Record<string, string>; leadStatus?: Record<string, string> };
}

/** Personas → dueños de HubSpot, invirtiendo el plan de la entrada (el primer dueño de cada persona: los activos van primero). */
export function ownersOut(plan: InboundPlan): Map<string, string> {
  const out = new Map<string, string>();
  for (const hs of plan.knownOwners) {
    const person = plan.owners[hs];
    if (person && !out.has(person)) out.set(person, hs);
  }
  // Un dueño que el plan conoce pero no está en knownOwners (no pasa, pero por las dudas).
  for (const [hs, person] of Object.entries(plan.owners)) if (!out.has(person)) out.set(person, hs);
  return out;
}

export type Converted = { ok: true; props: Record<string, string> } | { ok: false; code: string };

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Un valor nuestro (texto normalizado) como lo escribe una propiedad de HubSpot, según su definición. */
export function fitProperty(def: HsPropDef | undefined, raw: string): { ok: true; value: string } | { ok: false; code: string } {
  if (!def) return { ok: false, code: 'property_missing' };
  if (def.readOnly) return { ok: false, code: 'read_only' };
  if (raw === '') return { ok: true, value: '' };
  if (def.type === 'number') return /^-?\d+(\.\d+)?$/.test(raw) ? { ok: true, value: raw } : { ok: false, code: 'value_not_accepted' };
  if (def.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? { ok: true, value: raw } : { ok: false, code: 'value_not_accepted' };
  if (def.type === 'datetime') return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? { ok: true, value: `${raw}T00:00:00.000Z` } : { ok: false, code: 'value_not_accepted' };
  if (def.type === 'bool') return raw === 'true' || raw === 'false' ? { ok: true, value: raw } : { ok: false, code: 'value_not_accepted' };
  if (def.type === 'enumeration' && def.options?.length) {
    const out: string[] = [];
    for (const part of raw.split(';')) {
      const p = part.trim();
      if (!p) continue;
      const hit = def.options.find((o) => o.value === p) ?? def.options.find((o) => o.label.trim().toLowerCase() === p.toLowerCase()) ?? def.options.find((o) => o.value.toLowerCase() === p.toLowerCase());
      if (!hit) return { ok: false, code: 'value_not_accepted' };
      out.push(hit.value);
    }
    return { ok: true, value: out.join(';') };
  }
  return { ok: true, value: raw };
}

/** Valor de un campo propio nuestro (JSON) → texto para HubSpot, antes de mirar la definición. */
function customOut(field: PlanField, raw: string): string | null {
  if (raw === '') return '';
  const v = parseJson(raw);
  if (v === undefined || v === null) return '';
  const label = (x: unknown) => {
    const s = String(x);
    const entry = Object.entries(field.optionMap ?? {}).find(([, l]) => l === s);
    return entry ? entry[0] : s;
  };
  switch (field.type) {
    case 'user':
      return null;
    case 'boolean':
      return v === true ? 'true' : v === false ? 'false' : null;
    case 'number':
    case 'currency':
      return typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
    case 'select':
      return label(v);
    case 'multiselect':
      return (Array.isArray(v) ? v : [v]).map(label).join(';');
    default:
      return typeof v === 'object' ? null : String(v);
  }
}

/** Un campo nuestro (valor normalizado) → propiedades de HubSpot, o el código de por qué no se puede mandar. */
export function toHubspot(object: SyncObject, field: string, value: string, ctx: OutboundCtx): Converted {
  if (field.startsWith('custom.')) {
    const def = ctx.fields.find((f) => `custom.${f.name}` === field);
    if (!def) return { ok: false, code: 'property_missing' };
    const raw = customOut(def, value);
    if (raw === null) return { ok: false, code: 'value_not_accepted' };
    const fit = fitProperty(ctx.defs[def.key], raw);
    return fit.ok ? { ok: true, props: { [def.key]: fit.value } } : fit;
  }
  if (field === 'stage_id') {
    const hit = ctx.stages.get(value);
    if (!hit) return { ok: false, code: 'stage_unmapped' };
    return { ok: true, props: { pipeline: hit.pipeline, dealstage: hit.stage } };
  }
  const prop = OUTBOUND_PROPS[object][field];
  if (!prop) return { ok: false, code: 'property_missing' };
  let raw = value;
  if (field === 'owner_id') {
    if (value) {
      const hs = ctx.owners.get(value);
      if (!hs) return { ok: false, code: 'owner_unmapped' };
      raw = hs;
    }
    // El dueño de HubSpot es una referencia a sus usuarios: sus opciones no vienen en la definición.
    const def = ctx.defs[prop];
    if (!def) return { ok: false, code: 'property_missing' };
    if (def.readOnly) return { ok: false, code: 'read_only' };
    return { ok: true, props: { [prop]: raw } };
  }
  if (field === 'lifecycle_stage') raw = value ? (LIFECYCLE_OUT[value] ?? ctx.optionLabels?.lifecycle?.[value] ?? value) : '';
  else if (field === 'lead_status') raw = ctx.optionLabels?.leadStatus?.[value] ?? value.toUpperCase();
  const fit = fitProperty(ctx.defs[prop], raw);
  return fit.ok ? { ok: true, props: { [prop]: fit.value } } : fit;
}

/** Marca de un valor de HubSpot que la entrada no pudo traducir (un dueño de afuera, una opción desconocida): nunca es igual a nada nuestro. */
export const UNKNOWN_REMOTE = '\u0000unknown';

export interface PushPlan {
  /** Campos cambiados acá con HubSpot igual que en el último sync: se mandan. */
  push: string[];
  /** Cambiados acá que HubSpot ya tiene igual: solo se corre el shadow. */
  agree: string[];
  /** Cambiados de los dos lados: no se mandan. */
  conflicts: string[];
}

/** Qué campos cambiaron acá desde el último sync (sin mirar HubSpot): la vista previa y el filtro antes de leer HubSpot. */
export function changedHere(local: Values, shadow: Values): string[] {
  const out: string[] = [];
  for (const [field, l] of Object.entries(local)) {
    const s = shadow[field];
    if (s === undefined) continue;
    if (!same(field, l, s)) out.push(field);
  }
  return out;
}

/** La regla de la cabecera, campo por campo, para un registro vinculado. */
export function planPush(local: Values, shadow: Values, remote: Values): PushPlan {
  const out: PushPlan = { push: [], agree: [], conflicts: [] };
  for (const field of changedHere(local, shadow)) {
    const l = local[field] ?? '';
    const s = shadow[field];
    const r = field in remote ? remote[field] : UNKNOWN_REMOTE;
    if (same(field, l, r)) out.agree.push(field);
    else if (same(field, r, s)) out.push.push(field);
    else out.conflicts.push(field);
  }
  return out;
}
