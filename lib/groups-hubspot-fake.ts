/**
 * Lines: HubSpot falso en memoria (tests y demo). Responde como la API de
 * HubSpot que usa lib/groups-hubspot.ts: info del token, búsqueda y lectura de
 * empresas, negocios y contactos, owners, pipelines, notas y asociaciones.
 * Los datos son inventados. Nada sale a internet. Server-only.
 *
 * Tokens: cualquiera que empiece con "pat-" vale. Si contiene "noscope" solo
 * lee contactos (para probar el error de permisos); si contiene "readonly"
 * lee todo pero no puede escribir (ni notas ni propiedades).
 *
 * Empresas: además responde el esquema de propiedades y sus grupos, la lista
 * de dueños, batch/read, PATCH con las validaciones de HubSpot, la búsqueda
 * por fecha de modificación con paginado, el límite de llamadas (429) y las
 * empresas borradas o fusionadas.
 */
import type { FetchLike } from './groups-provider';

type Props = Record<string, string>;
interface FakeObject {
  id: string;
  properties: Props;
}
interface FakeNote {
  id: string;
  properties: Props;
  associations: string[];
}
interface FakeCall {
  method: string;
  path: string;
  body: unknown;
}
export interface FakePropertyDef {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  description?: string;
  options?: Array<{ label: string; value: string }>;
  hidden?: boolean;
  calculated?: boolean;
  hubspotDefined?: boolean;
  readOnlyValue?: boolean;
  referencedObjectType?: string;
  displayOrder?: number;
}
interface FakeHubspot {
  calls: FakeCall[];
  companies: Map<string, FakeObject>;
  deals: Map<string, FakeObject>;
  contacts: Map<string, FakeObject>;
  notes: Map<string, FakeNote>;
  seq: number;
  /** Definición de las propiedades de empresa (los tests pueden agregar o sacar). */
  companyProps: FakePropertyDef[];
  /** Empresa fusionada → la que quedó. */
  merged: Map<string, string>;
  /** Las próximas N llamadas autenticadas responden 429. */
  rateLimit: number;
  /** Reloj de HubSpot: nunca retrocede y cada cambio tiene su milisegundo. */
  clock: number;
}

export const FAKE_HUBSPOT_PORTAL = '424242';

const READ = ['crm.objects.companies.read', 'crm.objects.deals.read', 'crm.objects.contacts.read', 'crm.objects.owners.read', 'crm.schemas.companies.read'];
const WRITE = ['crm.objects.contacts.write', 'crm.objects.companies.write', 'crm.objects.deals.write'];

const OWNERS: Record<string, { firstName: string; lastName: string; email: string }> = {
  '71': { firstName: 'Paula', lastName: 'Ortiz', email: 'paula@zerosoft.example' },
  '72': { firstName: 'Bruno', lastName: 'Lima', email: 'bruno@zerosoft.example' },
};

const PIPELINES = [
  {
    id: 'default',
    label: 'Sales pipeline',
    stages: [
      { id: 'appointmentscheduled', label: 'Appointment scheduled' },
      { id: 'qualifiedtobuy', label: 'Qualified to buy' },
      { id: 'contractsent', label: 'Contract sent' },
      { id: 'closedwon', label: 'Closed won' },
    ],
  },
];

const PROP_GROUPS = [
  { name: 'companyinformation', label: 'Company information', displayOrder: 0 },
  { name: 'account_health', label: 'Account health', displayOrder: 1 },
  { name: 'company_activity', label: 'Activity', displayOrder: 2 },
];

const LIFECYCLE_OPTIONS = [
  { label: 'Subscriber', value: 'subscriber' },
  { label: 'Lead', value: 'lead' },
  { label: 'Marketing qualified lead', value: 'marketingqualifiedlead' },
  { label: 'Sales qualified lead', value: 'salesqualifiedlead' },
  { label: 'Opportunity', value: 'opportunity' },
  { label: 'Customer', value: 'customer' },
  { label: 'Evangelist', value: 'evangelist' },
  { label: 'Other', value: 'other' },
];

/** Propiedades de empresa del HubSpot falso: las de siempre, algunas propias, una calculada y una oculta. */
function companyProps(): FakePropertyDef[] {
  const info = 'companyinformation';
  const health = 'account_health';
  const sys = { hubspotDefined: true, readOnlyValue: true, groupName: 'company_activity' };
  return [
    { name: 'name', label: 'Company name', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'domain', label: 'Company domain name', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'description', label: 'Description', type: 'string', fieldType: 'textarea', groupName: info, hubspotDefined: true },
    { name: 'phone', label: 'Phone number', type: 'string', fieldType: 'phonenumber', groupName: info, hubspotDefined: true },
    { name: 'city', label: 'City', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    { name: 'country', label: 'Country/Region', type: 'string', fieldType: 'text', groupName: info, hubspotDefined: true },
    {
      name: 'industry',
      label: 'Industry',
      type: 'enumeration',
      fieldType: 'select',
      groupName: info,
      hubspotDefined: true,
      options: [
        { label: 'Transportation', value: 'TRANSPORTATION' },
        { label: 'Retail', value: 'RETAIL' },
        { label: 'Food production', value: 'FOOD_PRODUCTION' },
        { label: 'Computer software', value: 'COMPUTER_SOFTWARE' },
      ],
    },
    { name: 'numberofemployees', label: 'Number of employees', type: 'number', fieldType: 'number', groupName: info, hubspotDefined: true },
    { name: 'annualrevenue', label: 'Annual revenue', type: 'number', fieldType: 'number', groupName: info, hubspotDefined: true },
    { name: 'lifecyclestage', label: 'Lifecycle stage', type: 'enumeration', fieldType: 'radio', groupName: info, hubspotDefined: true, options: LIFECYCLE_OPTIONS },
    { name: 'hubspot_owner_id', label: 'Company owner', type: 'enumeration', fieldType: 'select', groupName: info, hubspotDefined: true, referencedObjectType: 'OWNER' },
    {
      name: 'plan_tier',
      label: 'Plan',
      type: 'enumeration',
      fieldType: 'select',
      groupName: health,
      options: [
        { label: 'Starter', value: 'starter' },
        { label: 'Growth', value: 'growth' },
        { label: 'Scale', value: 'scale' },
      ],
    },
    { name: 'renewal_date', label: 'Renewal date', type: 'date', fieldType: 'date', groupName: health },
    { name: 'last_review_at', label: 'Last business review', type: 'datetime', fieldType: 'date', groupName: health },
    { name: 'is_strategic', label: 'Strategic account', type: 'bool', fieldType: 'booleancheckbox', groupName: health, options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
    {
      name: 'products_used',
      label: 'Products in use',
      type: 'enumeration',
      fieldType: 'checkbox',
      groupName: health,
      options: [
        { label: 'Inbox', value: 'inbox' },
        { label: 'Broadcasts', value: 'broadcasts' },
        { label: 'Analytics', value: 'analytics' },
      ],
    },
    { name: 'health_score', label: 'Health score', type: 'number', fieldType: 'number', groupName: health },
    { name: 'csm_notes', label: 'Success notes', type: 'string', fieldType: 'textarea', groupName: health },
    { name: 'seats_per_employee', label: 'Seats per employee', type: 'number', fieldType: 'calculation_equation', groupName: health, calculated: true },
    { name: 'internal_sync_key', label: 'Internal sync key', type: 'string', fieldType: 'text', groupName: health, hidden: true },
    { name: 'createdate', label: 'Create date', type: 'datetime', fieldType: 'date', ...sys },
    { name: 'hs_lastmodifieddate', label: 'Last modified date', type: 'datetime', fieldType: 'date', ...sys },
    { name: 'hs_object_id', label: 'Record ID', type: 'number', fieldType: 'number', ...sys },
    { name: 'hs_merged_object_ids', label: 'Merged record IDs', type: 'enumeration', fieldType: 'checkbox', ...sys, hidden: true },
  ];
}

function seed(): FakeHubspot {
  const obj = (id: string, properties: Props): [string, FakeObject] => [id, { id, properties }];
  const created = '2026-01-15T12:00:00.000Z';
  const company = (id: string, properties: Props) => obj(id, { ...properties, hs_object_id: id, createdate: created, hs_lastmodifieddate: created });
  return {
    calls: [],
    seq: 5000,
    notes: new Map(),
    companyProps: companyProps(),
    merged: new Map(),
    rateLimit: 0,
    clock: 0,
    companies: new Map([
      company('9001', {
        name: 'Acme Logistics',
        domain: 'acme-logistics.example',
        hubspot_owner_id: '71',
        lifecyclestage: 'customer',
        industry: 'TRANSPORTATION',
        numberofemployees: '250',
        city: 'Rosario',
        phone: '+54 341 555 0100',
        plan_tier: 'growth',
        renewal_date: '2027-03-01',
        is_strategic: 'true',
        products_used: 'inbox;broadcasts',
        health_score: '82',
        seats_per_employee: '0.4',
        internal_sync_key: 'acme-001',
      }),
      company('9002', {
        name: 'Globex Retail',
        domain: 'globex-retail.example',
        hubspot_owner_id: '72',
        lifecyclestage: 'lead',
        industry: 'RETAIL',
        numberofemployees: '40',
        plan_tier: 'starter',
        renewal_date: '2026-12-10',
        is_strategic: 'false',
        products_used: 'inbox',
        health_score: '55',
      }),
      company('9003', { name: 'Initech Foods', domain: 'initech-foods.example', hubspot_owner_id: '', lifecyclestage: 'opportunity', industry: 'FOOD_PRODUCTION', numberofemployees: '900' }),
    ]),
    deals: new Map([
      obj('8001', { dealname: 'Acme Logistics renewal', dealstage: 'contractsent', pipeline: 'default', amount: '12000', deal_currency_code: 'USD', closedate: '2026-12-15T00:00:00Z', hubspot_owner_id: '71' }),
      obj('8002', { dealname: 'Globex Retail pilot', dealstage: 'qualifiedtobuy', pipeline: 'default', amount: '4500', deal_currency_code: 'USD', closedate: '2027-01-20T00:00:00Z', hubspot_owner_id: '72' }),
    ]),
    contacts: new Map([
      obj('7001', { firstname: 'Dana', lastname: 'Rivers', email: 'dana@acme-logistics.example', phone: '+54 9 11 5555-0142', company: 'Acme Logistics', associatedcompanyid: '9001', hubspot_owner_id: '71', lifecyclestage: 'customer' }),
      obj('7002', { firstname: 'Omar', lastname: 'Castell', email: 'omar@globex-retail.example', mobilephone: '+1 (415) 555-0177', company: 'Globex Retail', associatedcompanyid: '9002', hubspot_owner_id: '72', lifecyclestage: 'lead' }),
      obj('7003', { firstname: 'Lena', lastname: 'Duarte', email: 'lena@initech-foods.example', phone: '+52 55 5555 0199', company: 'Initech Foods', associatedcompanyid: '9003', lifecyclestage: 'opportunity' }),
      obj('7004', { firstname: 'Nico', lastname: 'Duarte', email: 'nico@initech-foods.example', hs_whatsapp_phone_number: '+525555550199', company: 'Initech Foods', associatedcompanyid: '9003', lifecyclestage: 'opportunity' }),
    ]),
  };
}

const holder = globalThis as unknown as { __groupsHubspotFake?: FakeHubspot };

/** El HubSpot falso (tests: mirar las llamadas, agregar o borrar registros). */
export function fakeHubspot(): FakeHubspot {
  return (holder.__groupsHubspotFake ??= seed());
}

export function resetFakeHubspot(): void {
  holder.__groupsHubspotFake = seed();
}

/** La hora del HubSpot falso para un cambio: la real, pero siempre un milisegundo después de la anterior. */
function tick(fake: FakeHubspot): string {
  fake.clock = Math.max(Date.now(), fake.clock + 1);
  return new Date(fake.clock).toISOString();
}

/** "Alguien editó la empresa en HubSpot": cambia propiedades y la fecha de modificación. Devuelve esa fecha. */
export function editFakeCompany(id: string, properties: Props): string {
  const fake = fakeHubspot();
  const o = fake.companies.get(id);
  if (!o) throw new Error(`fake company ${id}`);
  const at = tick(fake);
  Object.assign(o.properties, properties, { hs_lastmodifieddate: at });
  return at;
}

/** Fusiona `loserId` en `winnerId` como HubSpot: la primera deja de existir y la segunda guarda su id. */
export function mergeFakeCompanies(loserId: string, winnerId: string): void {
  const fake = fakeHubspot();
  const winner = fake.companies.get(winnerId);
  if (!winner || !fake.companies.has(loserId)) throw new Error('fake merge');
  fake.companies.delete(loserId);
  fake.merged.set(loserId, winnerId);
  const ids = (winner.properties.hs_merged_object_ids ?? '').split(';').filter(Boolean);
  winner.properties.hs_merged_object_ids = [...ids, loserId].join(';');
  winner.properties.hs_lastmodifieddate = tick(fake);
}

/** Lo que HubSpot diría de un valor que no acepta, o null si lo acepta. */
function invalidValue(def: FakePropertyDef | undefined, name: string, value: string): { message: string; error: string; name: string } | null {
  if (!def) return { message: `Property "${name}" does not exist`, error: 'PROPERTY_DOESNT_EXIST', name };
  if (def.readOnlyValue || def.calculated) return { message: `"${name}" is a read only property; its value cannot be set`, error: 'READ_ONLY_VALUE', name };
  if (value === '') return null;
  if (def.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) return { message: `${value} was not a valid number`, error: 'INVALID_INTEGER', name };
  if (def.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value) && !/^\d{10,14}$/.test(value)) return { message: `${value} was not a valid date`, error: 'INVALID_DATE', name };
  if (def.type === 'datetime' && !Number.isFinite(Date.parse(value)) && !/^\d{10,14}$/.test(value)) return { message: `${value} was not a valid date`, error: 'INVALID_DATE', name };
  if ((def.type === 'enumeration' || def.type === 'bool') && def.options?.length) {
    const bad = value.split(';').find((v) => !def.options?.some((o) => o.value === v));
    if (bad !== undefined) return { message: `${bad} was not one of the allowed options`, error: 'INVALID_OPTION', name };
  }
  return null;
}

function scopesOf(token: string): string[] | null {
  if (!token.startsWith('pat-')) return null;
  if (token.includes('noscope')) return ['crm.objects.contacts.read'];
  if (token.includes('readonly')) return [...READ];
  return [...READ, ...WRITE];
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const digits = (v: string | undefined) => String(v ?? '').replace(/\D/g, '');

const TABLES = { companies: 'companies', deals: 'deals', contacts: 'contacts' } as const;
type Table = keyof typeof TABLES;
const NAME_PROPS: Record<Table, string[]> = {
  companies: ['name', 'domain'],
  deals: ['dealname'],
  contacts: ['firstname', 'lastname', 'email', 'company'],
};

/** Valor de una propiedad; las hs_searchable_calculated_* son el teléfono solo con dígitos. */
function propValue(o: FakeObject, name: string): string {
  if (name === 'hs_searchable_calculated_phone_number') return digits(o.properties.phone);
  if (name === 'hs_searchable_calculated_mobile_number') return digits(o.properties.mobilephone);
  return o.properties[name] ?? '';
}

/** Un valor como número para comparar: fechas en milisegundos, números tal cual. */
function numeric(v: string): number {
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return Date.parse(v);
}

function matchesFilter(o: FakeObject, f: { propertyName?: string; operator?: string; value?: string; values?: string[] }): boolean {
  const have = propValue(o, String(f.propertyName ?? ''));
  const want = String(f.value ?? '');
  if (!have) return false;
  if (f.operator === 'EQ') return have.toLowerCase() === want.toLowerCase();
  if (f.operator === 'IN') return (f.values ?? []).map(String).includes(have);
  if (f.operator === 'GTE' || f.operator === 'GT' || f.operator === 'LTE' || f.operator === 'LT') {
    const a = numeric(have);
    const b = numeric(want);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return f.operator === 'GTE' ? a >= b : f.operator === 'GT' ? a > b : f.operator === 'LTE' ? a <= b : a < b;
  }
  if (f.operator === 'CONTAINS_TOKEN') {
    const core = want.replace(/^\*|\*$/g, '').toLowerCase();
    // Como HubSpot: el valor se parte en tokens; un teléfono con espacios no coincide entero.
    const tokens = have.toLowerCase().split(/[\s();-]+/).filter(Boolean);
    return tokens.some((tk) => (want.startsWith('*') ? tk.replace(/^\+/, '').endsWith(core) : want.endsWith('*') ? tk.startsWith(core) : tk === core));
  }
  return false;
}

function pick(o: FakeObject, properties: string[]): { id: string; properties: Props } {
  const out: Props = {};
  for (const p of properties) if (o.properties[p] !== undefined) out[p] = o.properties[p];
  return { id: o.id, properties: out };
}

export const fakeHubspotFetch: FetchLike = async (url, init) => {
  const fake = fakeHubspot();
  const u = new URL(url);
  const method = (init?.method ?? 'GET').toUpperCase();
  let body: Record<string, unknown> = {};
  try {
    body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  // El token nunca queda en el registro de llamadas.
  fake.calls.push({ method, path: u.pathname, body: u.pathname.includes('access-token-info') ? {} : body });
  if (fake.calls.length > 500) fake.calls.splice(0, 100);
  if (u.hostname !== 'api.hubapi.com') return json(404, { message: 'not found' });

  if (u.pathname === '/oauth/v2/private-apps/get/access-token-info') {
    const scopes = scopesOf(String(body.tokenKey ?? ''));
    if (!scopes) return json(401, { category: 'INVALID_AUTHENTICATION' });
    return json(200, { hubId: Number(FAKE_HUBSPOT_PORTAL), userId: 1, appId: 1, scopes });
  }

  const headers = new Headers(init?.headers);
  const scopes = scopesOf((headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  if (!scopes) return json(401, { category: 'INVALID_AUTHENTICATION' });
  const need = (scope: string) => (scopes.includes(scope) ? null : json(403, { category: 'MISSING_SCOPES' }));
  if (fake.rateLimit > 0) {
    fake.rateLimit--;
    return new Response(JSON.stringify({ status: 'error', errorType: 'RATE_LIMIT', policyName: 'TEN_SECONDLY_ROLLING' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '1' } });
  }

  if (u.pathname === '/account-info/v3/details') return json(200, { portalId: Number(FAKE_HUBSPOT_PORTAL), uiDomain: 'app.hubspot.com' });

  if (u.pathname === '/crm/v3/properties/companies' || u.pathname === '/crm/v3/properties/companies/groups' || u.pathname.startsWith('/crm/v3/properties/companies/')) {
    const denied = need('crm.schemas.companies.read');
    if (denied) return denied;
    if (u.pathname.endsWith('/groups')) return json(200, { results: PROP_GROUPS.map((g) => ({ ...g, archived: false })) });
    const toApi = (d: FakePropertyDef, i: number) => ({
      name: d.name,
      label: d.label,
      type: d.type,
      fieldType: d.fieldType,
      description: d.description ?? '',
      groupName: d.groupName,
      options: (d.options ?? []).map((o, n) => ({ ...o, displayOrder: n, hidden: false })),
      displayOrder: d.displayOrder ?? i,
      calculated: d.calculated === true,
      externalOptions: d.referencedObjectType === 'OWNER',
      ...(d.referencedObjectType ? { referencedObjectType: d.referencedObjectType } : {}),
      hasUniqueValue: false,
      hidden: d.hidden === true,
      hubspotDefined: d.hubspotDefined === true,
      modificationMetadata: { archivable: !d.hubspotDefined, readOnlyDefinition: d.hubspotDefined === true, readOnlyValue: d.readOnlyValue === true },
      formField: !d.hidden,
    });
    if (u.pathname === '/crm/v3/properties/companies') return json(200, { results: fake.companyProps.map(toApi) });
    const one = fake.companyProps.findIndex((d) => d.name === u.pathname.split('/').pop());
    return one >= 0 ? json(200, toApi(fake.companyProps[one], one)) : json(404, { category: 'OBJECT_NOT_FOUND' });
  }
  if (u.pathname === '/crm/v3/owners') {
    const denied = need('crm.objects.owners.read');
    if (denied) return denied;
    return json(200, { results: Object.entries(OWNERS).map(([id, o]) => ({ id, ...o, archived: false })) });
  }

  const owner = /^\/crm\/v3\/owners\/(\d+)$/.exec(u.pathname);
  if (owner) {
    const denied = need('crm.objects.owners.read');
    if (denied) return denied;
    const o = OWNERS[owner[1]];
    return o ? json(200, { id: owner[1], ...o }) : json(404, { category: 'OBJECT_NOT_FOUND' });
  }
  if (u.pathname === '/crm/v3/pipelines/deals') {
    const denied = need('crm.objects.deals.read');
    if (denied) return denied;
    return json(200, { results: PIPELINES });
  }

  const assoc = /^\/crm\/v4\/objects\/notes\/(\d+)\/associations\/default\/(companies|deals|contacts)\/(\d+)$/.exec(u.pathname);
  if (assoc && method === 'PUT') {
    const denied = need('crm.objects.contacts.write');
    if (denied) return denied;
    const note = fake.notes.get(assoc[1]);
    if (!note) return json(404, { category: 'OBJECT_NOT_FOUND' });
    const key = `${assoc[2]}:${assoc[3]}`;
    if (!note.associations.includes(key)) note.associations.push(key);
    return json(200, { status: 'COMPLETE' });
  }

  const notes = /^\/crm\/v3\/objects\/notes(?:\/(\d+))?$/.exec(u.pathname);
  if (notes) {
    const denied = need('crm.objects.contacts.write');
    if (denied) return denied;
    if (!notes[1] && method === 'POST') {
      const id = String(++fake.seq);
      const associations = (Array.isArray(body.associations) ? (body.associations as Array<{ to?: { id?: string }; types?: Array<{ associationTypeId?: number }> }>) : []).map((a) => {
        const typeId = a.types?.[0]?.associationTypeId;
        return `${typeId === 190 ? 'companies' : typeId === 214 ? 'deals' : 'contacts'}:${String(a.to?.id ?? '')}`;
      });
      fake.notes.set(id, { id, properties: { ...((body.properties ?? {}) as Props) }, associations });
      return json(201, { id, properties: body.properties ?? {} });
    }
    const note = notes[1] ? fake.notes.get(notes[1]) : undefined;
    if (!note) return json(404, { category: 'OBJECT_NOT_FOUND' });
    if (method === 'PATCH') {
      Object.assign(note.properties, (body.properties ?? {}) as Props);
      return json(200, { id: note.id, properties: note.properties });
    }
    return json(200, { id: note.id, properties: note.properties });
  }

  if (u.pathname === '/crm/v3/objects/companies/batch/read' && method === 'POST') {
    const denied = need('crm.objects.companies.read');
    if (denied) return denied;
    const inputs = (Array.isArray(body.inputs) ? (body.inputs as Array<{ id?: string }>) : []).map((i) => String(i?.id ?? ''));
    if (inputs.length > 100) return json(400, { status: 'error', category: 'VALIDATION_ERROR', message: 'The maximum number of inputs supported in a batch request is 100' });
    const properties = Array.isArray(body.properties) ? (body.properties as string[]) : [];
    const results: Array<{ id: string; properties: Record<string, string | null>; updatedAt: string }> = [];
    const missing: string[] = [];
    const sent = new Set<string>();
    for (const id of inputs) {
      // Una empresa fusionada devuelve la que quedó (con su propio id).
      const o = fake.companies.get(id) ?? fake.companies.get(fake.merged.get(id) ?? '');
      if (!o) {
        missing.push(id);
        continue;
      }
      if (sent.has(o.id)) continue;
      sent.add(o.id);
      const props: Record<string, string | null> = {};
      // Como HubSpot: una propiedad pedida y sin valor vuelve como null.
      for (const p of properties) props[p] = o.properties[p] === undefined || o.properties[p] === '' ? null : o.properties[p];
      results.push({ id: o.id, properties: props, updatedAt: o.properties.hs_lastmodifieddate });
    }
    if (missing.length === 0) return json(200, { status: 'COMPLETE', results });
    return json(207, { status: 'COMPLETE', results, numErrors: 1, errors: [{ status: 'error', category: 'OBJECT_NOT_FOUND', message: 'Could not get some company objects, they may be deleted or not exist.', context: { ids: missing } }] });
  }

  const objects = /^\/crm\/v3\/objects\/(companies|deals|contacts)(?:\/(search|\d+))?$/.exec(u.pathname);
  if (!objects) return json(404, { message: 'not found' });
  const table = objects[1] as Table;
  const denied = need(`crm.objects.${table}.read`);
  if (denied) return denied;
  const rows = [...fake[table].values()];
  if (table === 'companies' && objects[2] && objects[2] !== 'search' && method === 'PATCH') {
    const noWrite = need('crm.objects.companies.write');
    if (noWrite) return noWrite;
    const o = fake.companies.get(objects[2]);
    if (!o) return json(404, { category: 'OBJECT_NOT_FOUND' });
    const patch = (body.properties ?? {}) as Props;
    const problems = Object.entries(patch)
      .map(([name, value]) => invalidValue(fake.companyProps.find((d) => d.name === name), name, String(value ?? '')))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (problems.length) {
      return json(400, { status: 'error', category: 'VALIDATION_ERROR', message: `Property values were not valid: ${JSON.stringify(problems.map((x) => ({ isValid: false, ...x })))}` });
    }
    const at = tick(fake);
    for (const [name, value] of Object.entries(patch)) o.properties[name] = String(value ?? '');
    o.properties.hs_lastmodifieddate = at;
    return json(200, { id: o.id, properties: { ...patch, hs_lastmodifieddate: at }, updatedAt: at });
  }
  if (objects[2] === 'search' && method === 'POST') {
    const properties = Array.isArray(body.properties) ? (body.properties as string[]) : [];
    const limit = Math.min(Number(body.limit) || 10, 100);
    const q = String(body.query ?? '').trim().toLowerCase();
    const groups = Array.isArray(body.filterGroups) ? (body.filterGroups as Array<{ filters?: Array<{ propertyName?: string; operator?: string; value?: string; values?: string[] }> }>) : [];
    // Como HubSpot: el texto se parte en palabras y cada una tiene que estar en alguna de las propiedades de nombre.
    const words = q.split(/\s+/).filter(Boolean);
    const hits = rows.filter((o) => {
      if (words.length && !words.every((w) => NAME_PROPS[table].some((p) => (o.properties[p] ?? '').toLowerCase().includes(w)))) return false;
      if (groups.length && !groups.some((g) => (g.filters ?? []).every((f) => matchesFilter(o, f)))) return false;
      return true;
    });
    const sort = (Array.isArray(body.sorts) ? (body.sorts as Array<{ propertyName?: string; direction?: string }>) : [])[0];
    if (sort?.propertyName) {
      const dir = sort.direction === 'DESCENDING' ? -1 : 1;
      hits.sort((a, b) => dir * (numeric(propValue(a, String(sort.propertyName))) - numeric(propValue(b, String(sort.propertyName)))));
    }
    const after = Math.max(0, Number(body.after) || 0);
    const page = hits.slice(after, after + limit);
    return json(200, {
      total: hits.length,
      results: page.map((o) => pick(o, properties)),
      ...(after + limit < hits.length ? { paging: { next: { after: String(after + limit) } } } : {}),
    });
  }
  if (objects[2] && method === 'GET') {
    const o = fake[table].get(objects[2]) ?? (table === 'companies' ? fake.companies.get(fake.merged.get(objects[2]) ?? '') : undefined);
    if (!o) return json(404, { category: 'OBJECT_NOT_FOUND' });
    return json(200, pick(o, (u.searchParams.get('properties') ?? '').split(',').filter(Boolean)));
  }
  if (!objects[2] && method === 'GET') {
    return json(200, { results: rows.slice(0, Math.min(Number(u.searchParams.get('limit')) || 10, 100)).map((o) => pick(o, [])) });
  }
  return json(404, { message: 'not found' });
};
