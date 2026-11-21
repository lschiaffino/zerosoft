/**
 * CRM ↔ HubSpot, entrada (S2): de un registro de HubSpot a los valores de un
 * registro nuestro, y la regla de qué valor queda. Server-only; sin base ni
 * red, para probarlo solo.
 *
 * Los valores se comparan como texto normalizado (mismos recortes, fechas
 * YYYY-MM-DD, números redondeados, email en minúsculas) para que un registro
 * recién traído no aparezca como distinto la vuelta siguiente. Las reglas de
 * lifecycle, lead status y dominio son las del importador y la vista previa
 * (lib/crm-hubspot-sync/fields.ts).
 *
 * La regla de qué queda, por campo, contra el `shadow` (lo último que el sync
 * vio igual de los dos lados):
 * - nuestro valor igual al de HubSpot: no hay nada que hacer;
 * - nuestro valor no cambió desde el último sync: gana HubSpot;
 * - HubSpot no cambió y el nuestro sí: queda el nuestro (lo lleva a HubSpot
 *   el bloque que escribe allá);
 * - cambiaron los dos: queda el nuestro y se anota como conflicto, hasta que
 *   el dueño elija la regla.
 * Un campo que el sync nunca vio (sin shadow) se completa si está vacío acá
 * (o tiene el valor por defecto); si ya tiene otro valor, solo lo pisa un
 * registro "de confianza" (traído por el importador y sin tocar desde
 * entonces). Un vacío de HubSpot nunca borra un valor nuestro la primera vez.
 */
import { coerceCustom } from '../crm-import';
import { dbTimestamp, htmlToText } from '../crm-import-source';
import { normalizeCompanyDomain } from '../crm-domain';
import type { CrmCustomFieldType } from '../schema/types';
import { additionalEmails, hubspotCompanyDomain, leadStatusFromHubspot, lifecycleFromHubspot, type HsProps } from './fields';
import type { ActivityObject, SyncObject } from './reader';

export type InboundObject = SyncObject | ActivityObject;
export const INBOUND_OBJECTS: readonly InboundObject[] = ['companies', 'contacts', 'deals', 'notes', 'calls', 'meetings', 'tasks', 'emails'];
export const isActivityObject = (o: InboundObject): o is ActivityObject => o !== 'contacts' && o !== 'companies' && o !== 'deals';

export interface PlanField {
  /** Nombre interno de la propiedad en HubSpot. */
  key: string;
  /** Nombre del campo propio nuestro. */
  name: string;
  type: CrmCustomFieldType;
  options: string[];
  /** Valor interno de una opción de HubSpot → su etiqueta (nuestras opciones son etiquetas). */
  optionMap?: Record<string, string>;
}

export interface PlanStage {
  id: string;
  pipelineId: string;
  won: boolean;
  lost: boolean;
}

/** Lo que el sync sabe de la cuenta: se arma al empezar y se renueva cada tanto. */
export interface InboundPlan {
  /** Dueño de HubSpot → persona del workspace con ese email. */
  owners: Record<string, string>;
  /** Todos los dueños de HubSpot conocidos (con o sin persona): uno nuevo pide renovar el plan. */
  knownOwners: string[];
  stages: Record<string, PlanStage>;
  defaultStage: { id: string; pipelineId: string } | null;
  fields: Partial<Record<SyncObject, PlanField[]>>;
}

export const emptyPlan = (): InboundPlan => ({ owners: {}, knownOwners: [], stages: {}, defaultStage: null, fields: {} });

/** Campos estándar que trae cada objeto, en el orden en que se escriben. */
export const INBOUND_FIELDS: Record<InboundObject, readonly string[]> = {
  contacts: ['first_name', 'last_name', 'email', 'phone', 'job_title', 'website', 'city', 'country', 'lifecycle_stage', 'lead_status', 'owner_id'],
  companies: ['name', 'domain', 'industry', 'employees', 'phone', 'website', 'city', 'country', 'lifecycle_stage', 'owner_id'],
  deals: ['name', 'stage_id', 'amount', 'currency', 'close_date', 'description', 'lost_reason', 'owner_id'],
  notes: ACTIVITY_FIELDS(),
  calls: ACTIVITY_FIELDS(),
  meetings: ACTIVITY_FIELDS(),
  tasks: ACTIVITY_FIELDS(),
  emails: ACTIVITY_FIELDS(),
};

function ACTIVITY_FIELDS(): string[] {
  return ['subject', 'body', 'at', 'due_at', 'done', 'direction', 'outcome', 'duration_min', 'owner_id', 'contact_id', 'company_id', 'deal_id'];
}

/** Lo que se le pide a HubSpot de cada objeto (además de los campos propios del plan). */
export const INBOUND_PROPS: Record<InboundObject, readonly string[]> = {
  contacts: ['firstname', 'lastname', 'email', 'phone', 'mobilephone', 'jobtitle', 'website', 'city', 'country', 'lifecyclestage', 'hs_lead_status', 'hubspot_owner_id', 'hs_additional_emails', 'hs_merged_object_ids'],
  companies: ['name', 'domain', 'industry', 'numberofemployees', 'phone', 'website', 'city', 'country', 'lifecyclestage', 'hubspot_owner_id', 'hs_parent_company_id', 'hs_merged_object_ids'],
  deals: ['dealname', 'pipeline', 'dealstage', 'amount', 'deal_currency_code', 'closedate', 'description', 'closed_lost_reason', 'hubspot_owner_id', 'hs_merged_object_ids'],
  notes: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'],
  calls: ['hs_call_title', 'hs_call_body', 'hs_timestamp', 'hs_call_direction', 'hs_call_duration', 'hs_call_disposition', 'hubspot_owner_id'],
  meetings: ['hs_meeting_title', 'hs_meeting_body', 'hs_timestamp', 'hs_meeting_start_time', 'hs_meeting_end_time', 'hs_meeting_outcome', 'hubspot_owner_id'],
  tasks: ['hs_task_subject', 'hs_task_body', 'hs_timestamp', 'hs_task_status', 'hubspot_owner_id'],
  emails: ['hs_email_subject', 'hs_email_text', 'hs_email_html', 'hs_email_direction', 'hs_timestamp', 'hubspot_owner_id'],
};

/** Asociaciones que se leen por lote para cada objeto. */
export const INBOUND_ASSOC: Record<InboundObject, readonly SyncObject[]> = {
  companies: [],
  contacts: ['companies'],
  deals: ['contacts', 'companies'],
  notes: ['contacts', 'companies', 'deals'],
  calls: ['contacts', 'companies', 'deals'],
  meetings: ['contacts', 'companies', 'deals'],
  tasks: ['contacts', 'companies', 'deals'],
  emails: ['contacts', 'companies', 'deals'],
};

/** Valor por defecto de una columna nuestra: contra un vacío de HubSpot no cuenta como diferencia. */
const DEFAULTS: Record<string, string> = { lifecycle_stage: 'lead', lead_status: 'new', amount: '0' };

export type Values = Record<string, string>;

const hs = (p: HsProps, k: string) => (p[k] ?? '').trim();
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export function numberText(raw: string): string {
  if (!raw) return '';
  const n = Number(raw);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
}

function ymdText(raw: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  return m ? m[1] : '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Mapped {
  values: Values;
  /** Campos que esta vez no se tocan (HubSpot manda algo que no tiene equivalente acá). */
  skip: Set<string>;
  /** Hay un dueño o una etapa que el plan no conoce: hay que renovarlo antes de escribir. */
  stale?: boolean;
}

/** Un contacto, empresa o negocio de HubSpot, como valores nuestros. */
export function mapRecord(object: SyncObject, p: HsProps, plan: InboundPlan): Mapped {
  const skip = new Set<string>();
  const v: Values = {};
  const owner = hs(p, 'hubspot_owner_id');
  const stale = Boolean(owner) && !plan.knownOwners.includes(owner);
  v.owner_id = (owner && plan.owners[owner]) || '';
  // Un dueño de HubSpot sin persona acá (o que dejó el workspace) no le saca el dueño al registro: no se toca.
  if (owner && !plan.owners[owner]) skip.add('owner_id');
  if (object === 'contacts') {
    const email = hs(p, 'email').toLowerCase();
    v.first_name = hs(p, 'firstname').slice(0, 120);
    v.last_name = hs(p, 'lastname').slice(0, 120);
    v.email = EMAIL_RE.test(email) ? email.slice(0, 254) : '';
    if (email && !v.email) skip.add('email');
    v.phone = (hs(p, 'phone') || hs(p, 'mobilephone')).slice(0, 60);
    v.job_title = hs(p, 'jobtitle').slice(0, 200);
    v.website = hs(p, 'website').slice(0, 300);
    v.city = hs(p, 'city').slice(0, 120);
    v.country = hs(p, 'country').slice(0, 120);
    const lifecycle = lifecycleFromHubspot(hs(p, 'lifecyclestage'));
    const lead = leadStatusFromHubspot(hs(p, 'hs_lead_status'));
    v.lifecycle_stage = lifecycle ?? '';
    v.lead_status = lead ?? '';
    if (lifecycle === null) skip.add('lifecycle_stage');
    if (lead === null) skip.add('lead_status');
  } else if (object === 'companies') {
    const domain = hubspotCompanyDomain(p);
    v.name = (hs(p, 'name') || domain).slice(0, 200);
    v.domain = domain;
    v.industry = hs(p, 'industry').slice(0, 200);
    const employees = numberText(hs(p, 'numberofemployees'));
    v.employees = employees ? String(Math.max(0, Math.round(Number(employees)))) : '';
    v.phone = hs(p, 'phone').slice(0, 60);
    v.website = hs(p, 'website').slice(0, 300);
    v.city = hs(p, 'city').slice(0, 120);
    v.country = hs(p, 'country').slice(0, 120);
    const lifecycle = lifecycleFromHubspot(hs(p, 'lifecyclestage'));
    v.lifecycle_stage = lifecycle ?? '';
    if (lifecycle === null) skip.add('lifecycle_stage');
  } else {
    const stageId = hs(p, 'dealstage');
    const stage = stageId ? plan.stages[stageId] : undefined;
    v.name = (hs(p, 'dealname') || 'Deal').slice(0, 200);
    v.stage_id = stage?.id ?? '';
    if (!stage) skip.add('stage_id');
    const amount = numberText(hs(p, 'amount'));
    v.amount = amount && Number(amount) < 0 ? '0' : amount;
    const currency = hs(p, 'deal_currency_code').toUpperCase();
    v.currency = /^[A-Z]{3}$/.test(currency) ? currency : '';
    if (!v.currency) skip.add('currency');
    v.close_date = ymdText(hs(p, 'closedate'));
    v.description = hs(p, 'description').slice(0, 5000);
    v.lost_reason = stage?.lost ? hs(p, 'closed_lost_reason').slice(0, 200) : '';
    if (!stage?.lost) skip.add('lost_reason');
    return { values: v, skip, stale: stale || (Boolean(stageId) && !stage) };
  }
  return { values: v, skip, stale };
}

/** Lo nuestro, normalizado igual que mapRecord. */
export function localValues(object: InboundObject, row: Record<string, unknown>): Values {
  const out: Values = {};
  for (const f of INBOUND_FIELDS[object]) {
    const raw = text(row[f === 'at' ? 'created_at' : f]);
    if (f === 'email') out[f] = raw.toLowerCase();
    else if (f === 'domain') out[f] = normalizeCompanyDomain(raw);
    else if (f === 'employees' || f === 'amount') out[f] = numberText(raw);
    else if (f === 'close_date') out[f] = ymdText(raw);
    else if (f === 'currency') out[f] = raw.toUpperCase();
    else if (f === 'done') out[f] = raw === '1' || raw === 'true' ? '1' : '0';
    else out[f] = raw;
  }
  return out;
}

/**
 * Campos propios: valor de HubSpot → valor nuestro (texto JSON, '' si está
 * vacío). Un valor que viene pero no se puede convertir (una opción oculta, un
 * tipo distinto) va a `skip`: no se toca lo nuestro.
 */
export function mapCustom(fields: PlanField[], p: HsProps): { values: Values; skip: string[] } {
  const out: Values = {};
  const skip: string[] = [];
  for (const f of fields) {
    let v = hs(p, f.key);
    if (v && f.type === 'select') v = f.optionMap?.[v] ?? v;
    else if (v && f.type === 'multiselect') {
      v = v
        .split(';')
        .map((x) => f.optionMap?.[x.trim()] ?? x.trim())
        .filter(Boolean)
        .join(',');
    } else if (v && f.type === 'date' && /^\d{11,}$/.test(v)) v = new Date(Number(v)).toISOString().slice(0, 10);
    if (f.type === 'user') continue;
    const coerced = v ? coerceCustom([{ name: f.name, type: f.type, options: JSON.stringify(f.options) }], { [f.name]: v }, 0, [])[f.name] : undefined;
    if (v && coerced === undefined) skip.push(`custom.${f.name}`);
    out[`custom.${f.name}`] = coerced === undefined ? '' : JSON.stringify(coerced);
  }
  return { values: out, skip };
}

export function localCustom(fields: PlanField[], custom: Record<string, unknown>): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = custom[f.name];
    out[`custom.${f.name}`] = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? '' : JSON.stringify(v);
  }
  return out;
}

// ---------- Actividades ----------

export interface MappedActivity {
  type: 'note' | 'call' | 'meeting' | 'task' | 'email';
  values: Values;
  skip: Set<string>;
  stale: boolean;
}

/** Una nota, llamada, reunión, tarea o email de HubSpot como actividad nuestra (las asociaciones se resuelven aparte). */
export function mapActivity(object: ActivityObject, p: HsProps, plan: InboundPlan, nowDb: string): MappedActivity {
  const owner = hs(p, 'hubspot_owner_id');
  const at = dbTimestamp(hs(p, 'hs_timestamp')) || nowDb;
  const v: Values = { owner_id: (owner && plan.owners[owner]) || '', at, due_at: '', done: '1', direction: '', outcome: '', duration_min: '', subject: '', body: '' };
  let type: MappedActivity['type'] = 'note';
  if (object === 'notes') v.body = htmlToText(hs(p, 'hs_note_body'));
  else if (object === 'calls') {
    type = 'call';
    const dir = hs(p, 'hs_call_direction').toUpperCase();
    const ms = Number(hs(p, 'hs_call_duration'));
    v.subject = hs(p, 'hs_call_title');
    v.body = htmlToText(hs(p, 'hs_call_body'));
    v.direction = dir === 'INBOUND' ? 'inbound' : dir === 'OUTBOUND' ? 'outbound' : '';
    v.duration_min = hs(p, 'hs_call_duration') && Number.isFinite(ms) ? String(Math.round(ms / 60000)) : '';
  } else if (object === 'meetings') {
    type = 'meeting';
    const start = dbTimestamp(hs(p, 'hs_meeting_start_time')) || at;
    const end = dbTimestamp(hs(p, 'hs_meeting_end_time'));
    const dur = start && end ? Math.round((Date.parse(`${end.replace(' ', 'T')}Z`) - Date.parse(`${start.replace(' ', 'T')}Z`)) / 60000) : null;
    v.subject = hs(p, 'hs_meeting_title');
    v.body = htmlToText(hs(p, 'hs_meeting_body'));
    v.at = start;
    v.due_at = start;
    v.done = start <= nowDb ? '1' : '0';
    v.duration_min = dur !== null && dur >= 0 ? String(dur) : '';
    v.outcome = hs(p, 'hs_meeting_outcome').toLowerCase();
  } else if (object === 'tasks') {
    type = 'task';
    v.subject = hs(p, 'hs_task_subject');
    v.body = htmlToText(hs(p, 'hs_task_body'));
    v.due_at = at;
    v.done = hs(p, 'hs_task_status').toUpperCase() === 'COMPLETED' ? '1' : '0';
  } else {
    type = 'email';
    const dir = hs(p, 'hs_email_direction').toUpperCase();
    v.subject = hs(p, 'hs_email_subject');
    v.body = hs(p, 'hs_email_text') || htmlToText(hs(p, 'hs_email_html'));
    v.direction = dir === 'INCOMING_EMAIL' ? 'inbound' : dir ? 'outbound' : '';
  }
  v.subject = v.subject.slice(0, 300);
  v.body = v.body.slice(0, 20_000);
  v.outcome = v.outcome.slice(0, 60);
  const skip = new Set<string>(owner && !plan.owners[owner] ? ['owner_id'] : []);
  return { type, values: v, skip, stale: Boolean(owner) && !plan.knownOwners.includes(owner) };
}

// ---------- Regla de qué queda ----------

export interface Resolution {
  /** Campos donde se escribe el valor de HubSpot. */
  apply: string[];
  /** Campos con cambios de los dos lados: queda el nuestro. */
  conflicts: string[];
  /** El shadow nuevo. */
  shadow: Values;
}

function same(field: string, a: string, b: string): boolean {
  if (a === b) return true;
  const d = DEFAULTS[field];
  return d !== undefined && ((a === '' && b === d) || (b === '' && a === d));
}

/**
 * Qué campos se escriben. `trusted`: el registro lo creó el sync o lo trajo el
 * importador y nadie lo tocó acá desde entonces; sus campos sin shadow los
 * decide HubSpot. Un campo en `skip` no se toca ni entra al shadow.
 */
export function resolve(remote: Values, local: Values, shadow: Values, opts: { trusted: boolean; skip?: Set<string> }): Resolution {
  const out: Resolution = { apply: [], conflicts: [], shadow: { ...shadow } };
  for (const [field, r] of Object.entries(remote)) {
    if (opts.skip?.has(field)) continue;
    const l = local[field] ?? '';
    const s = shadow[field];
    if (same(field, l, r)) {
      out.shadow[field] = r;
      continue;
    }
    if (s === undefined) {
      // Primera vez que se ve este campo. Un vacío de HubSpot no borra lo nuestro: queda como algo que solo tiene este lado.
      if (r === '') out.shadow[field] = r;
      else if (l === '' || l === DEFAULTS[field] || opts.trusted) {
        out.apply.push(field);
        out.shadow[field] = r;
      } else out.conflicts.push(field);
      continue;
    }
    if (same(field, l, s)) {
      out.apply.push(field);
      out.shadow[field] = r;
    } else if (same(field, r, s)) {
      // Cambió solo acá: queda lo nuestro; el shadow sigue siendo lo último que se vio igual.
    } else out.conflicts.push(field);
  }
  return out;
}

/** Emails con los que se busca un contacto nuestro: el principal y los secundarios de HubSpot. */
export function contactEmails(p: HsProps): string[] {
  const primary = hs(p, 'email').toLowerCase();
  return [...new Set([primary, ...additionalEmails(p).map((e) => e.toLowerCase())].filter((e) => EMAIL_RE.test(e)))];
}
