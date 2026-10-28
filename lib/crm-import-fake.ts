/**
 * CRM — proveedor falso para tests: un `fetch` que imita la API de HubSpot y la
 * de Pipedrive con un set de datos determinístico. Lo usan los unit tests y el
 * e2e (sin red real).
 *
 * Solo se activa con CRM_IMPORT_FAKE=1 y además NODE_ENV=test o DEMO_MODE=true
 * (ver fakeImportAllowed); en producción normal nunca. El token elige el
 * tamaño: "fake" (24 contactos) o "fake-<n>".
 */
import type { FetchLike } from './crm-import-source';

export function fakeImportAllowed(): boolean {
  if (process.env.CRM_IMPORT_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

export function isFakeToken(token: string): boolean {
  return /^fake(-\d{1,6})?$/.test(token);
}

export interface FakeDataset {
  contacts: number;
  /** Emails de los dos owners del otro CRM (el primero suele coincidir con alguien del workspace). */
  ownerEmails: [string, string];
}

export function fakeDatasetFromToken(token: string, ownerEmail = 'demo@zerosoft.ai'): FakeDataset {
  const m = /^fake-(\d+)$/.exec(token);
  return { contacts: m ? Math.max(1, Number(m[1])) : 24, ownerEmails: [ownerEmail, 'sam@fake-crm.test'] };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Página por cursor numérico (HubSpot `after`, Pipedrive `start`). */
function slice<T>(rows: T[], start: number, limit: number) {
  const items = rows.slice(start, start + limit);
  const next = start + limit < rows.length ? start + limit : null;
  return { items, next };
}

// ---------- Datos ----------

function build(ds: FakeDataset) {
  const n = ds.contacts;
  const nCompanies = Math.max(3, Math.ceil(n / 4));
  const nDeals = Math.max(2, Math.ceil(n / 3));
  const day = (i: number) => `2026-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, '0')}`;
  const companies = Array.from({ length: nCompanies }, (_, i) => ({
    id: String(1000 + i),
    name: `Company ${i + 1}`,
    domain: `company${i + 1}.example`,
    industry: i % 2 ? 'Software' : 'Retail',
    employees: 10 * (i + 1),
    owner: String(i % 2 ? 2 : 1),
    parent: i === 1 ? '1000' : '',
    tier: i % 2 ? 'gold' : 'silver',
  }));
  const contacts = Array.from({ length: n }, (_, i) => ({
    id: String(5000 + i),
    first: `Person${i + 1}`,
    last: 'Fake',
    email: `person${i + 1}@company${(i % nCompanies) + 1}.example`,
    owner: String(i % 2 ? 2 : 1),
    company: companies[i % nCompanies].id,
    secondary: i % 5 === 0 ? companies[(i + 1) % nCompanies].id : '',
    color: i % 3 ? 'Blue' : '',
  }));
  const stages = [
    { id: 'appointmentscheduled', label: 'Appointment scheduled', probability: '0.2', closed: 'false' },
    { id: 'qualifiedtobuy', label: 'Qualified to buy', probability: '0.4', closed: 'false' },
    { id: 'closedwon', label: 'Closed won', probability: '1.0', closed: 'true' },
    { id: 'closedlost', label: 'Closed lost', probability: '0.0', closed: 'true' },
  ];
  const deals = Array.from({ length: nDeals }, (_, i) => ({
    id: String(9000 + i),
    name: `Deal ${i + 1}`,
    amount: 1000 * (i + 1),
    stage: stages[i % stages.length].id,
    close: day(i),
    owner: String(i % 2 ? 2 : 1),
    contact: contacts[i % n].id,
    company: contacts[i % n].company,
  }));
  const notes = Array.from({ length: Math.ceil(n / 2) }, (_, i) => ({
    id: String(20000 + i),
    body: `<p>Note ${i + 1} about the account</p>`,
    at: `${day(i)}T10:00:00.000Z`,
    owner: '1',
    contact: contacts[i % n].id,
    deal: i === 0 ? deals[0].id : '',
  }));
  const calls = [{ id: '30000', title: 'Discovery call', at: `${day(1)}T15:00:00.000Z`, contact: contacts[0].id }];
  const meetings = [{ id: '31000', title: 'Demo', at: `${day(2)}T16:00:00.000Z`, contact: contacts[0].id }];
  const tasks = [{ id: '32000', title: 'Send proposal', at: '2030-01-15T12:00:00.000Z', contact: contacts[0].id }];
  const emails = [{ id: '33000', title: 'Re: pricing', at: `${day(3)}T09:00:00.000Z`, contact: contacts[0].id }];
  return { companies, contacts, deals, stages, notes, calls, meetings, tasks, emails };
}

// ---------- HubSpot ----------

export function fakeHubspotFetch(ds: FakeDataset, log: string[] = []): FetchLike {
  const d = build(ds);
  const owners = [
    { id: '1', email: ds.ownerEmails[0], firstName: 'Demo', lastName: 'Owner' },
    { id: '2', email: ds.ownerEmails[1], firstName: 'Sam', lastName: 'Seller' },
  ];
  const objects: Record<string, Array<{ id: string; properties: Record<string, string> }>> = {
    companies: d.companies.map((c) => ({
      id: c.id,
      properties: {
        name: c.name,
        domain: c.domain,
        industry: c.industry,
        numberofemployees: String(c.employees),
        hubspot_owner_id: c.owner,
        hs_parent_company_id: c.parent,
        tier: c.tier,
      },
    })),
    contacts: d.contacts.map((c) => ({
      id: c.id,
      properties: {
        firstname: c.first,
        lastname: c.last,
        email: c.email,
        lifecyclestage: 'marketingqualifiedlead',
        hs_lead_status: 'IN_PROGRESS',
        hs_analytics_source: 'ORGANIC_SEARCH',
        hubspot_owner_id: c.owner,
        favorite_color: c.color,
      },
    })),
    deals: d.deals.map((x) => ({
      id: x.id,
      properties: {
        dealname: x.name,
        pipeline: 'default',
        dealstage: x.stage,
        amount: String(x.amount),
        deal_currency_code: 'USD',
        closedate: `${x.close}T00:00:00.000Z`,
        hubspot_owner_id: x.owner,
        renewal: 'true',
      },
    })),
    notes: d.notes.map((x) => ({
      id: x.id,
      properties: { hs_note_body: x.body, hs_timestamp: x.at, hubspot_owner_id: x.owner },
    })),
    calls: d.calls.map((x) => ({
      id: x.id,
      properties: {
        hs_call_title: x.title,
        hs_call_body: 'Talked about goals',
        hs_timestamp: x.at,
        hs_call_direction: 'OUTBOUND',
        hs_call_duration: '900000',
        hubspot_owner_id: '1',
      },
    })),
    meetings: d.meetings.map((x) => ({
      id: x.id,
      properties: {
        hs_meeting_title: x.title,
        hs_meeting_body: 'Product demo',
        hs_timestamp: x.at,
        hs_meeting_start_time: x.at,
        hs_meeting_end_time: x.at.replace('16:00', '16:30'),
        hubspot_owner_id: '2',
      },
    })),
    tasks: d.tasks.map((x) => ({
      id: x.id,
      properties: { hs_task_subject: x.title, hs_timestamp: x.at, hs_task_status: 'NOT_STARTED', hubspot_owner_id: '1' },
    })),
    emails: d.emails.map((x) => ({
      id: x.id,
      properties: { hs_email_subject: x.title, hs_email_text: 'Here are the prices', hs_email_direction: 'INCOMING_EMAIL', hs_timestamp: x.at },
    })),
  };
  const assoc: Record<string, Record<string, Array<{ toObjectId: string; associationTypes: Array<{ category: string; typeId: number; label: string | null }> }>>> = {};
  const add = (from: string, to: string, id: string, toId: string, primary: boolean, typeId: number) => {
    if (!toId) return;
    const key = `${from}/${to}`;
    assoc[key] ??= {};
    (assoc[key][id] ??= []).push({
      toObjectId: toId,
      associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: primary ? typeId : 279, label: primary ? 'Primary' : null }],
    });
  };
  for (const c of d.contacts) {
    add('contacts', 'companies', c.id, c.secondary, false, 1);
    add('contacts', 'companies', c.id, c.company, true, 1);
  }
  for (const x of d.deals) {
    add('deals', 'contacts', x.id, x.contact, false, 3);
    add('deals', 'companies', x.id, x.company, true, 5);
  }
  for (const x of d.notes) {
    add('notes', 'contacts', x.id, x.contact, false, 202);
    add('notes', 'deals', x.id, x.deal, false, 214);
  }
  for (const kind of ['calls', 'meetings', 'tasks', 'emails'] as const) {
    for (const x of d[kind]) add(kind, 'contacts', x.id, x.contact, false, 194);
  }

  const properties: Record<string, unknown[]> = {
    contacts: [
      { name: 'email', label: 'Email', type: 'string', fieldType: 'text', hubspotDefined: true },
      { name: 'favorite_color', label: 'Favorite color', type: 'string', fieldType: 'text', hubspotDefined: false },
    ],
    companies: [
      {
        name: 'tier',
        label: 'Tier',
        type: 'enumeration',
        fieldType: 'select',
        hubspotDefined: false,
        options: [
          { label: 'Gold', value: 'gold' },
          { label: 'Silver', value: 'silver' },
        ],
      },
    ],
    deals: [{ name: 'renewal', label: 'Renewal', type: 'enumeration', fieldType: 'booleancheckbox', hubspotDefined: false }],
  };

  return async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    log.push(`${method} ${u.pathname}`);
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';
    if (!/^Bearer fake(-\d+)?$/.test(auth)) return json({ status: 'error', category: 'INVALID_AUTHENTICATION' }, 401);
    const limit = Number(u.searchParams.get('limit') ?? 100);
    const after = Number(u.searchParams.get('after') ?? 0);
    const path = u.pathname;
    const paged = (rows: unknown[]) => {
      const { items, next } = slice(rows, after, limit);
      return json({ results: items, ...(next !== null ? { paging: { next: { after: String(next) } } } : {}) });
    };
    if (path === '/crm/v3/owners') return paged(owners);
    let m = /^\/crm\/v3\/properties\/(\w+)$/.exec(path);
    if (m) return json({ results: properties[m[1]] ?? [] });
    if (path === '/crm/v3/pipelines/deals') {
      return json({
        results: [
          {
            id: 'default',
            label: 'Sales Pipeline',
            displayOrder: 0,
            stages: d.stages.map((s, i) => ({
              id: s.id,
              label: s.label,
              displayOrder: i,
              metadata: { probability: s.probability, isClosed: s.closed },
            })),
          },
        ],
      });
    }
    // Listas: una de contactos (los primeros 3) y una de empresas (la primera).
    if (path === '/crm/v3/lists/search' && method === 'POST') {
      const lists = [
        { listId: '71', name: 'Newsletter', objectTypeId: '0-1', processingType: 'MANUAL', size: Math.min(3, d.contacts.length) },
        { listId: '72', name: 'Key accounts', objectTypeId: '0-2', processingType: 'DYNAMIC', size: 1 },
      ];
      const body = JSON.parse(String(init?.body ?? '{}')) as { count?: number; offset?: number };
      const start = body.offset ?? 0;
      const count = body.count ?? 20;
      return json({ lists: lists.slice(start, start + count), hasMore: start + count < lists.length, offset: start + count, total: lists.length });
    }
    m = /^\/crm\/v3\/lists\/(\w+)\/memberships$/.exec(path);
    if (m) {
      const members = m[1] === '71' ? d.contacts.slice(0, 3).map((c) => c.id) : m[1] === '72' ? [d.companies[0].id] : [];
      return paged(members.map((recordId) => ({ recordId, membershipTimestamp: '2026-01-01T00:00:00.000Z' })));
    }
    m = /^\/crm\/v3\/objects\/(\w+)\/search$/.exec(path);
    if (m) return json({ total: objects[m[1]]?.length ?? 0, results: [] });
    m = /^\/crm\/v3\/objects\/(\w+)$/.exec(path);
    if (m) return paged(objects[m[1]] ?? []);
    m = /^\/crm\/v4\/associations\/(\w+)\/(\w+)\/batch\/read$/.exec(path);
    if (m && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { inputs: Array<{ id: string }> };
      const table = assoc[`${m[1]}/${m[2]}`] ?? {};
      return json({
        results: body.inputs.filter((i) => table[i.id]).map((i) => ({ from: { id: i.id }, to: table[i.id] })),
      });
    }
    return json({ message: 'not found' }, 404);
  };
}

// ---------- Pipedrive ----------

export function fakePipedriveFetch(ds: FakeDataset, log: string[] = []): FetchLike {
  const d = build(ds);
  const tierKey = 'a'.repeat(40);
  const colorKey = 'b'.repeat(40);
  const users = [
    { id: 1, name: 'Demo Owner', email: ds.ownerEmails[0] },
    { id: 2, name: 'Sam Seller', email: ds.ownerEmails[1] },
  ];
  const stageIds: Record<string, number> = { appointmentscheduled: 1, qualifiedtobuy: 2 };
  const tables: Record<string, Array<Record<string, unknown>>> = {
    '/organizations': d.companies.map((c) => ({
      id: Number(c.id),
      name: c.name,
      website: `https://${c.domain}`,
      owner_id: { id: Number(c.owner) },
      [tierKey]: c.tier === 'gold' ? '11' : '12',
    })),
    '/persons': d.contacts.map((c) => ({
      id: Number(c.id),
      name: `${c.first} ${c.last}`,
      first_name: c.first,
      last_name: c.last,
      email: [{ value: c.email, primary: true }],
      phone: [{ value: '+1 555 0100', primary: true }],
      org_id: { value: Number(c.company), name: 'x' },
      owner_id: { id: Number(c.owner) },
      [colorKey]: c.color,
    })),
    '/deals': d.deals.map((x) => ({
      id: Number(x.id),
      title: x.name,
      value: x.amount,
      currency: 'EUR',
      status: x.stage === 'closedwon' ? 'won' : x.stage === 'closedlost' ? 'lost' : 'open',
      stage_id: stageIds[x.stage] ?? 2,
      pipeline_id: 1,
      person_id: { value: Number(x.contact) },
      org_id: { value: Number(x.company) },
      user_id: { id: Number(x.owner) },
      expected_close_date: x.close,
      won_time: x.stage === 'closedwon' ? `${x.close} 12:00:00` : null,
    })),
    '/notes': d.notes.map((x) => ({
      id: Number(x.id),
      content: x.body,
      add_time: x.at.slice(0, 19).replace('T', ' '),
      user_id: 1,
      person_id: Number(x.contact),
      deal_id: x.deal ? Number(x.deal) : null,
    })),
    '/activities': [
      { id: 1, type: 'call', subject: 'Discovery call', due_date: '2026-02-02', due_time: '15:00', duration: '00:15', done: true, user_id: 1, person_id: Number(d.contacts[0].id) },
      { id: 2, type: 'meeting', subject: 'Demo', due_date: '2026-02-03', due_time: '16:00', duration: '00:30', done: true, user_id: 2, person_id: Number(d.contacts[0].id) },
      { id: 3, type: 'task', subject: 'Send proposal', due_date: '2030-01-15', due_time: '', done: false, user_id: 1, person_id: Number(d.contacts[0].id) },
    ],
  };
  const fields: Record<string, unknown[]> = {
    '/personFields': [
      { key: 'name', name: 'Name', field_type: 'varchar' },
      { key: colorKey, name: 'Favorite color', field_type: 'varchar' },
    ],
    '/organizationFields': [
      { key: tierKey, name: 'Tier', field_type: 'enum', options: [{ id: 11, label: 'Gold' }, { id: 12, label: 'Silver' }] },
    ],
    '/dealFields': [],
  };

  return async (url, init) => {
    const u = new URL(url);
    log.push(`${init?.method ?? 'GET'} ${u.pathname}`);
    const token = (init?.headers as Record<string, string> | undefined)?.['x-api-token'] ?? '';
    if (!/^fake(-\d+)?$/.test(token)) return json({ success: false, error: 'unauthorized' }, 401);
    const path = u.pathname.replace(/^\/v1/, '');
    const start = Number(u.searchParams.get('start') ?? 0);
    const limit = Number(u.searchParams.get('limit') ?? 100);
    const paged = (rows: unknown[]) => {
      const { items, next } = slice(rows, start, limit);
      return json({
        success: true,
        data: items,
        additional_data: { pagination: { start, limit, more_items_in_collection: next !== null, ...(next !== null ? { next_start: next } : {}) } },
      });
    };
    if (path === '/users') return json({ success: true, data: users });
    if (fields[path]) return paged(fields[path]);
    if (path === '/pipelines') return paged([{ id: 1, name: 'Pipeline', order_nr: 1 }]);
    if (path === '/stages') {
      return paged([
        { id: 1, name: 'Qualified', pipeline_id: 1, deal_probability: 20, order_nr: 1 },
        { id: 2, name: 'Proposal made', pipeline_id: 1, deal_probability: 60, order_nr: 2 },
      ]);
    }
    if (tables[path]) return paged(tables[path]);
    return json({ success: false, error: 'not found' }, 404);
  };
}
