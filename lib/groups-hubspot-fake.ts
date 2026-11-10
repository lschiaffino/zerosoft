/**
 * Lines: HubSpot falso en memoria (tests y demo). Responde como la API de
 * HubSpot que usa lib/groups-hubspot.ts: info del token, búsqueda y lectura de
 * empresas, negocios y contactos, owners, pipelines, notas y asociaciones.
 * Los datos son inventados. Nada sale a internet. Server-only.
 *
 * Tokens: cualquiera que empiece con "pat-" vale. Si contiene "noscope" solo
 * lee contactos (para probar el error de permisos); si contiene "readonly"
 * lee todo pero no puede escribir notas.
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
interface FakeHubspot {
  calls: FakeCall[];
  companies: Map<string, FakeObject>;
  deals: Map<string, FakeObject>;
  contacts: Map<string, FakeObject>;
  notes: Map<string, FakeNote>;
  seq: number;
}

export const FAKE_HUBSPOT_PORTAL = '424242';

const READ = ['crm.objects.companies.read', 'crm.objects.deals.read', 'crm.objects.contacts.read', 'crm.objects.owners.read'];
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

function seed(): FakeHubspot {
  const obj = (id: string, properties: Props): [string, FakeObject] => [id, { id, properties }];
  return {
    calls: [],
    seq: 5000,
    notes: new Map(),
    companies: new Map([
      obj('9001', { name: 'Acme Logistics', domain: 'acme-logistics.example', hubspot_owner_id: '71', lifecyclestage: 'customer' }),
      obj('9002', { name: 'Globex Retail', domain: 'globex-retail.example', hubspot_owner_id: '72', lifecyclestage: 'lead' }),
      obj('9003', { name: 'Initech Foods', domain: 'initech-foods.example', hubspot_owner_id: '', lifecyclestage: 'opportunity' }),
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

function matchesFilter(o: FakeObject, f: { propertyName?: string; operator?: string; value?: string }): boolean {
  const have = propValue(o, String(f.propertyName ?? ''));
  const want = String(f.value ?? '');
  if (!have) return false;
  if (f.operator === 'EQ') return have.toLowerCase() === want.toLowerCase();
  if (f.operator === 'CONTAINS_TOKEN') {
    const core = want.replace(/^\*|\*$/g, '').toLowerCase();
    // Como HubSpot: el valor se parte en tokens; un teléfono con espacios no coincide entero.
    const tokens = have.toLowerCase().split(/[\s()-]+/).filter(Boolean);
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

  if (u.pathname === '/account-info/v3/details') return json(200, { portalId: Number(FAKE_HUBSPOT_PORTAL), uiDomain: 'app.hubspot.com' });

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

  const objects = /^\/crm\/v3\/objects\/(companies|deals|contacts)(?:\/(search|\d+))?$/.exec(u.pathname);
  if (!objects) return json(404, { message: 'not found' });
  const table = objects[1] as Table;
  const denied = need(`crm.objects.${table}.read`);
  if (denied) return denied;
  const rows = [...fake[table].values()];
  if (objects[2] === 'search' && method === 'POST') {
    const properties = Array.isArray(body.properties) ? (body.properties as string[]) : [];
    const limit = Math.min(Number(body.limit) || 10, 100);
    const q = String(body.query ?? '').trim().toLowerCase();
    const groups = Array.isArray(body.filterGroups) ? (body.filterGroups as Array<{ filters?: Array<{ propertyName?: string; operator?: string; value?: string }> }>) : [];
    const hits = rows.filter((o) => {
      if (q && !NAME_PROPS[table].some((p) => (o.properties[p] ?? '').toLowerCase().includes(q))) return false;
      if (groups.length && !groups.some((g) => (g.filters ?? []).every((f) => matchesFilter(o, f)))) return false;
      return true;
    });
    return json(200, { total: hits.length, results: hits.slice(0, limit).map((o) => pick(o, properties)) });
  }
  if (objects[2] && method === 'GET') {
    const o = fake[table].get(objects[2]);
    if (!o) return json(404, { category: 'OBJECT_NOT_FOUND' });
    return json(200, pick(o, (u.searchParams.get('properties') ?? '').split(',').filter(Boolean)));
  }
  if (!objects[2] && method === 'GET') {
    return json(200, { results: rows.slice(0, Math.min(Number(u.searchParams.get('limit')) || 10, 100)).map((o) => pick(o, [])) });
  }
  return json(404, { message: 'not found' });
};
