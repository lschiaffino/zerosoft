/**
 * CRM ↔ HubSpot — qué campo estándar de zerosoft es cada propiedad de HubSpot
 * y cómo se comparan sus valores. Server-only; no lee la base ni la red.
 *
 * Los valores de HubSpot pasan por las mismas reglas que el importador
 * (lib/crm-import-jobs.ts): mismos recortes, mismo mapeo de lifecycle y lead
 * status, mismo dominio limpio. Si no, un registro recién importado ya
 * aparecería como "distinto".
 *
 * Lo que NO cuenta como diferencia:
 * - un valor por defecto nuestro contra un vacío de HubSpot (lifecycle 'lead',
 *   lead status 'new', monto 0): lo pone el alta, nadie lo eligió;
 * - el dueño, si HubSpot no tiene uno o el suyo no es una persona del
 *   workspace (eso se lista aparte, en dueños);
 * - la etapa, si la de HubSpot no tiene equivalente (se lista en pipelines);
 * - un valor de HubSpot que nuestro campo no acepta (un lifecycle propio).
 */
import { LEAD_STATUSES, LIFECYCLE_STAGES } from '../crm-constants';
import { normalizeCompanyDomain } from '../crm-domain';
import { normalizeImportValue } from '../crm-import';
import type { PreviewObject } from './types';

export type HsProps = Record<string, string | null>;
export type LocalRow = Record<string, string | number | null | undefined>;

/** Dueños y etapas de HubSpot que tienen equivalente de este lado (id de HubSpot → id nuestro). */
export interface ComparePlan {
  owners: Record<string, string>;
  stages: Record<string, string>;
}

/** Propiedad de HubSpot de cada campo estándar nuestro que el sync empareja. */
export const STANDARD_FIELDS: Record<PreviewObject, Record<string, string>> = {
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
    owner_id: 'hubspot_owner_id',
  },
};

/** Campos estándar nuestros que HubSpot no tiene o no deja escribir (claves de crm.hubspotSync.localFields). */
export const ZEROSOFT_ONLY_FIELDS: Record<PreviewObject, string[]> = {
  contacts: ['source', 'tags', 'score'],
  companies: ['tags', 'description'],
  deals: ['priority', 'source', 'tags'],
};

/** Lo que se le pide a HubSpot de cada objeto: los campos emparejados y lo que hace falta para vincular. */
export const HS_READ_PROPS: Record<PreviewObject, string[]> = {
  contacts: [...Object.values(STANDARD_FIELDS.contacts), 'mobilephone', 'hs_additional_emails', 'hs_merged_object_ids'],
  companies: [...Object.values(STANDARD_FIELDS.companies), 'hs_merged_object_ids'],
  deals: [...Object.values(STANDARD_FIELDS.deals), 'pipeline', 'hs_merged_object_ids'],
};

/** Columnas nuestras que se leen para comparar. */
export const LOCAL_COLUMNS: Record<PreviewObject, string[]> = {
  contacts: ['id', 'owner_id', 'first_name', 'last_name', 'email', 'phone', 'job_title', 'website', 'city', 'country', 'lifecycle_stage', 'lead_status', 'updated_at'],
  companies: ['id', 'owner_id', 'name', 'domain', 'industry', 'employees', 'phone', 'website', 'city', 'country', 'lifecycle_stage', 'updated_at'],
  deals: ['id', 'owner_id', 'stage_id', 'name', 'amount', 'currency', 'close_date', 'description', 'updated_at'],
};

export const LOCAL_TABLES: Record<PreviewObject, string> = { contacts: 'crm_contacts', companies: 'crm_companies', deals: 'crm_deals' };
/** El nombre del objeto en crm_external_ids y crm_hubspot_links. */
export const LINK_OBJECT: Record<PreviewObject, string> = { contacts: 'contact', companies: 'company', deals: 'deal' };

const hs = (p: HsProps, k: string) => (p[k] ?? '').trim();
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

function inEnum(list: readonly string[], v: string): string | null {
  const lower = v.trim().toLowerCase();
  return list.includes(lower) ? lower : null;
}

/** Lifecycle de HubSpot → el nuestro (el mapeo del importador); null si es uno propio de esa cuenta que nuestro campo no acepta. */
export function lifecycleFromHubspot(raw: string): string | null {
  return raw.trim() ? inEnum(LIFECYCLE_STAGES, normalizeImportValue('lifecycleStage', raw)) : '';
}

export function leadStatusFromHubspot(raw: string): string | null {
  return raw.trim() ? inEnum(LEAD_STATUSES, normalizeImportValue('leadStatus', raw)) : '';
}

/** Emails secundarios de un contacto de HubSpot (hs_additional_emails, separados por ';'). */
export function additionalEmails(p: HsProps): string[] {
  return hs(p, 'hs_additional_emails')
    .split(/[;,\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'))
    .slice(0, 10);
}

/** Ids de los registros que HubSpot fusionó en este. */
export function mergedIds(p: HsProps): string[] {
  return hs(p, 'hs_merged_object_ids')
    .split(';')
    .map((x) => x.trim())
    .filter((x) => /^\d{1,20}$/.test(x))
    .slice(0, 50);
}

/** El dominio de una empresa de HubSpot, limpio como el nuestro (cae al sitio web si no hay dominio). */
export function hubspotCompanyDomain(p: HsProps): string {
  return normalizeCompanyDomain(hs(p, 'domain')) || normalizeCompanyDomain(hs(p, 'website'));
}

export interface FieldDiff {
  /** Los dos lados tienen valor y no es el mismo. */
  conflicting: string[];
  /** Un lado está vacío y el otro no. */
  filling: string[];
}

interface Pair {
  field: string;
  remote: string;
  local: string;
  /** No comparar (no hay equivalente de este lado). */
  skip?: boolean;
}

function ymd(raw: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  return m ? m[1] : '';
}

function numberText(raw: string): string {
  if (!raw) return '';
  const n = Number(raw);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
}

function pairs(object: PreviewObject, p: HsProps, row: LocalRow, plan: ComparePlan): Pair[] {
  const owner = hs(p, 'hubspot_owner_id');
  const ownerPair: Pair = { field: 'owner_id', remote: plan.owners[owner] ?? '', local: text(row.owner_id), skip: !owner || !plan.owners[owner] };
  if (object === 'contacts') {
    const lifecycle = lifecycleFromHubspot(hs(p, 'lifecyclestage'));
    const lead = leadStatusFromHubspot(hs(p, 'hs_lead_status'));
    const localLifecycle = text(row.lifecycle_stage);
    const localLead = text(row.lead_status);
    return [
      { field: 'first_name', remote: hs(p, 'firstname').slice(0, 120), local: text(row.first_name) },
      { field: 'last_name', remote: hs(p, 'lastname').slice(0, 120), local: text(row.last_name) },
      { field: 'email', remote: hs(p, 'email').toLowerCase(), local: text(row.email).toLowerCase() },
      { field: 'phone', remote: (hs(p, 'phone') || hs(p, 'mobilephone')).slice(0, 60), local: text(row.phone) },
      { field: 'job_title', remote: hs(p, 'jobtitle').slice(0, 200), local: text(row.job_title) },
      { field: 'website', remote: hs(p, 'website').slice(0, 300), local: text(row.website) },
      { field: 'city', remote: hs(p, 'city').slice(0, 120), local: text(row.city) },
      { field: 'country', remote: hs(p, 'country').slice(0, 120), local: text(row.country) },
      { field: 'lifecycle_stage', remote: lifecycle ?? '', local: localLifecycle, skip: lifecycle === null || (lifecycle === '' && localLifecycle === 'lead') },
      { field: 'lead_status', remote: lead ?? '', local: localLead, skip: lead === null || (lead === '' && localLead === 'new') },
      ownerPair,
    ];
  }
  if (object === 'companies') {
    const lifecycle = lifecycleFromHubspot(hs(p, 'lifecyclestage'));
    const localLifecycle = text(row.lifecycle_stage);
    return [
      { field: 'name', remote: hs(p, 'name').slice(0, 200), local: text(row.name) },
      { field: 'domain', remote: hubspotCompanyDomain(p), local: normalizeCompanyDomain(text(row.domain)) },
      { field: 'industry', remote: hs(p, 'industry').slice(0, 200), local: text(row.industry) },
      { field: 'employees', remote: numberText(hs(p, 'numberofemployees')), local: numberText(text(row.employees)) },
      { field: 'phone', remote: hs(p, 'phone').slice(0, 60), local: text(row.phone) },
      { field: 'website', remote: hs(p, 'website').slice(0, 300), local: text(row.website) },
      { field: 'city', remote: hs(p, 'city').slice(0, 120), local: text(row.city) },
      { field: 'country', remote: hs(p, 'country').slice(0, 120), local: text(row.country) },
      { field: 'lifecycle_stage', remote: lifecycle ?? '', local: localLifecycle, skip: lifecycle === null || (lifecycle === '' && localLifecycle === 'lead') },
      ownerPair,
    ];
  }
  const stage = hs(p, 'dealstage');
  const amount = numberText(hs(p, 'amount'));
  const localAmount = numberText(text(row.amount));
  const currency = hs(p, 'deal_currency_code').toUpperCase();
  return [
    { field: 'name', remote: hs(p, 'dealname').slice(0, 200), local: text(row.name) },
    { field: 'stage_id', remote: plan.stages[stage] ?? '', local: text(row.stage_id), skip: !stage || !plan.stages[stage] },
    { field: 'amount', remote: amount, local: localAmount, skip: amount === '' && (localAmount === '' || localAmount === '0') },
    { field: 'currency', remote: currency, local: text(row.currency).toUpperCase(), skip: !/^[A-Z]{3}$/.test(currency) },
    { field: 'close_date', remote: ymd(hs(p, 'closedate')), local: ymd(text(row.close_date)) },
    { field: 'description', remote: hs(p, 'description').slice(0, 5000), local: text(row.description) },
    ownerPair,
  ];
}

/** Qué campos estándar difieren entre un registro de HubSpot y el nuestro. */
export function diffRecord(object: PreviewObject, p: HsProps, row: LocalRow, plan: ComparePlan): FieldDiff {
  const out: FieldDiff = { conflicting: [], filling: [] };
  for (const x of pairs(object, p, row, plan)) {
    if (x.skip || x.remote === x.local) continue;
    if (x.remote && x.local) out.conflicting.push(x.field);
    else out.filling.push(x.field);
  }
  return out;
}

/** `a,b;c`: campos en conflicto, punto y coma, campos que se completan. '' si no difiere nada. */
export function encodeDiff(d: FieldDiff): string {
  return d.conflicting.length || d.filling.length ? `${d.conflicting.join(',')};${d.filling.join(',')}` : '';
}

export function decodeDiff(raw: string): FieldDiff {
  const [c = '', f = ''] = raw.split(';');
  return { conflicting: c.split(',').filter(Boolean), filling: f.split(',').filter(Boolean) };
}

/** Cómo se muestra un registro de HubSpot en una muestra. */
export function hubspotLabel(object: PreviewObject, p: HsProps, id: string): { label: string; detail: string } {
  if (object === 'contacts') {
    const name = `${hs(p, 'firstname')} ${hs(p, 'lastname')}`.trim();
    const email = hs(p, 'email');
    return { label: (name || email || `#${id}`).slice(0, 160), detail: (name ? email : '').slice(0, 200) };
  }
  if (object === 'companies') {
    const domain = hubspotCompanyDomain(p);
    return { label: (hs(p, 'name') || domain || `#${id}`).slice(0, 160), detail: (hs(p, 'name') ? domain : '').slice(0, 200) };
  }
  const amount = numberText(hs(p, 'amount'));
  return { label: (hs(p, 'dealname') || `#${id}`).slice(0, 160), detail: amount ? `${amount} ${hs(p, 'deal_currency_code').toUpperCase()}`.trim() : '' };
}
