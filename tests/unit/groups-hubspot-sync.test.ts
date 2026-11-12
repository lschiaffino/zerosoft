import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { groupsViewer, systemViewer, updatePlatformSettings } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { runGroupsCron } from '@/lib/groups-cron';
import { cleanListFilters, listQuery } from '@/lib/groups-org';
import { HUBSPOT_SCOPES, chatHubspot, connectHubspot, disconnectHubspot, getHubspot, linkHubspot, updateHubspotSettings } from '@/lib/groups-hubspot';
import {
  applyHubspotSnapshot,
  chatCompany,
  getHubspotSchema,
  handleHubspotWebhook,
  hubspotSignatureV3,
  importHubspotCompanies,
  listUnlinkedGroups,
  refreshHubspotSchema,
  setHubspotPinned,
  suggestCompaniesForGroups,
  syncHubspotCompanies,
  updateHubspotCompanyProperty,
} from '@/lib/groups-hubspot-sync';
import { cleanHubspotFilters, formatHubspotValue, hubspotOpsFor, nameSimilarity, parseHubspotFilterParam, type HubspotPropFilter } from '@/lib/groups-hubspot-shared';
import { editFakeCompany, fakeHubspot, mergeFakeCompanies, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { makeUser } from './helpers';

/** Sesión que usan las rutas (getCurrentUser), para probar como otra persona. */
const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const companyRoute = await import('@/app/api/groups/hubspot/company/route');
const propsRoute = await import('@/app/api/groups/hubspot/properties/route');
const unlinkedRoute = await import('@/app/api/groups/hubspot/unlinked/route');
const webhookRoute = await import('@/app/api/groups/hubspot/webhook/route');
const chatsRoute = await import('@/app/api/groups/chats/route');
const fakeRoute = await import('@/app/api/groups/hubspot/fake/route');

const TOKEN = 'pat-na1-fake-token-for-sync-tests';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetFakeHubspot();
});
afterEach(() => {
  session.user = null;
});

const groupMsg = (chatId: string, id: string, name: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: true,
  chatName: name,
  fromMe: false,
  senderPhone: '5491100000009',
  senderName: 'Cliente',
  providerMessageId: id,
  body: 'Hola',
});

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

let seq = 0;
/** Un grupo nuevo en esa línea. */
async function group(ws: string, row: Awaited<ReturnType<typeof line>>, name: string) {
  seq += 1;
  await ingestEvents(row, [groupMsg(`12036377${String(seq).padStart(6, '0')}@g.us`, `sync-${seq}-${Math.random().toString(36).slice(2, 8)}`, name)]);
  const c = (await listChats(ws, ws, { limit: 500 })).rows.find((r) => r.name === name);
  if (!c) throw new Error(`chat ${name}`);
  return c;
}

/** Workspace conectado con una línea y tres grupos: Acme (9001), Globex (9002) y uno sin vincular. */
async function world(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const row = await line(owner.id, 'Clientes');
  const acme = await group(owner.id, row, `Acme Logistics soporte ${label}`);
  const globex = await group(owner.id, row, `Globex ${label}`);
  const loose = await group(owner.id, row, `Proveedores ${label}`);
  await connectHubspot(owner.id, owner.id, TOKEN);
  await linkHubspot(owner.id, owner.id, acme.id, 'company', '9001');
  await linkHubspot(owner.id, owner.id, globex.id, 'company', '9002');
  return { owner, row, acme, globex, loose };
}

const calls = (method: string, path: string | RegExp) => fakeHubspot().calls.filter((c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path)));
const patches = () => calls('PATCH', /^\/crm\/v3\/objects\/companies\/\d+$/);
const batchReads = () => calls('POST', '/crm/v3/objects/companies/batch/read');
const searches = () => calls('POST', '/crm/v3/objects/companies/search');

async function logOf(ws: string, companyId: string) {
  return (await getDb()
    .prepare('SELECT direction, property, old_value, new_value, actor_id, source FROM groups_hubspot_sync_log WHERE user_id = ? AND company_id = ? ORDER BY created_at, rowid')
    .all(ws, companyId)) as Array<{ direction: string; property: string; old_value: string; new_value: string; actor_id: string | null; source: string }>;
}

async function valuesOf(ws: string, companyId: string): Promise<Record<string, string>> {
  const row = (await getDb().prepare('SELECT props FROM groups_hubspot_companies WHERE user_id = ? AND company_id = ?').get(ws, companyId)) as { props: string } | undefined;
  return row ? (JSON.parse(row.props) as Record<string, string>) : {};
}

/** El sync de un workspace en un minuto posterior (cada corrida mira "ahora"). */
const cron = (ws: string, minutes = 0) => syncHubspotCompanies({ workspaceId: ws, now: new Date(Date.now() + minutes * 60_000) });

describe('HubSpot: esquema de propiedades', () => {
  it('al conectar importa todas las propiedades de empresa, también las propias, con tipo, opciones y si se editan', async () => {
    const ws = await makeUser('hs-schema');
    await connectHubspot(ws.id, ws.id, TOKEN);
    const schema = await getHubspotSchema(ws.id);
    expect(schema.connected).toBe(true);
    expect(schema.syncedAt).toBeTruthy();
    expect(schema.canWrite).toBe(true);
    const by = new Map(schema.props.map((p) => [p.name, p]));
    // Las ocultas se importan y se guardan, pero no van a la interfaz.
    const stored = (await getDb().prepare('SELECT name, hidden FROM groups_hubspot_props WHERE user_id = ?').all(ws.id)) as Array<{ name: string; hidden: number }>;
    expect(stored).toHaveLength(fakeHubspot().companyProps.length);
    expect(stored.find((r) => r.name === 'internal_sync_key')?.hidden).toBe(1);
    expect(by.has('internal_sync_key')).toBe(false);
    expect(by.get('name')).toMatchObject({ label: 'Company name', kind: 'text', group: 'companyinformation', readOnly: false, custom: false });
    expect(by.get('description')?.kind).toBe('textarea');
    expect(by.get('numberofemployees')?.kind).toBe('number');
    expect(by.get('renewal_date')).toMatchObject({ kind: 'date', custom: true });
    expect(by.get('last_review_at')?.kind).toBe('datetime');
    expect(by.get('is_strategic')?.kind).toBe('bool');
    expect(by.get('products_used')?.kind).toBe('multi');
    expect(by.get('plan_tier')).toMatchObject({ kind: 'select', options: [{ label: 'Starter', value: 'starter' }, { label: 'Growth', value: 'growth' }, { label: 'Scale', value: 'scale' }] });
    expect(by.get('hubspot_owner_id')?.kind).toBe('owner');
    // Solo lectura y calculadas: se ven, no se editan.
    expect(by.get('createdate')).toMatchObject({ readOnly: true, calculated: false });
    expect(by.get('seats_per_employee')).toMatchObject({ readOnly: true, calculated: true });
    expect(schema.groups.map((g) => g.label)).toEqual(['Company information', 'Account health', 'Activity']);
    expect(schema.owners).toEqual([{ id: '71', name: 'Paula Ortiz' }, { id: '72', name: 'Bruno Lima' }]);
    expect(schema.pinned).toEqual(['domain', 'hubspot_owner_id', 'lifecyclestage']);
  });

  it('"Actualizar propiedades" trae las nuevas y archiva las que ya no están; el cron lo repite cada 6 horas', async () => {
    const w = await world('hs-schema-refresh');
    const fake = fakeHubspot();
    fake.companyProps.push({ name: 'nps', label: 'NPS', type: 'number', fieldType: 'number', groupName: 'account_health' });
    fake.companyProps = fake.companyProps.filter((p) => p.name !== 'csm_notes');
    session.user = { ...w.owner, role: 'owner' };
    const res = await propsRoute.POST(new Request('http://x/api/groups/hubspot/properties', { method: 'POST', body: JSON.stringify({ refresh: true }) }));
    expect(res.status).toBe(200);
    const names = ((await res.json()) as { props: Array<{ name: string }> }).props.map((p) => p.name);
    expect(names).toContain('nps');
    expect(names).not.toContain('csm_notes');
    // Periódico: con el esquema viejo, el cron lo vuelve a importar.
    fake.companyProps.push({ name: 'segment', label: 'Segment', type: 'string', fieldType: 'text', groupName: 'account_health' });
    await getDb().prepare('UPDATE groups_hubspot SET schema_synced_at = ? WHERE user_id = ?').run(new Date(Date.now() - 7 * 3_600_000).toISOString(), w.owner.id);
    await cron(w.owner.id);
    expect((await getHubspotSchema(w.owner.id)).props.map((p) => p.name)).toContain('segment');
  });

  it('las fijadas las elige un admin; un miembro lee el esquema y no lo cambia', async () => {
    const w = await world('hs-pins');
    const member = await makeUser('hs-pins-m');
    const url = 'http://x/api/groups/hubspot/properties';
    const post = (body: unknown) => propsRoute.POST(new Request(url, { method: 'POST', body: JSON.stringify(body) }));
    session.user = { ...w.owner, role: 'member', actingUser: { id: member.id } };
    expect((await propsRoute.GET()).status).toBe(200);
    expect((await post({ pinned: ['plan_tier'] })).status).toBe(403);
    session.user = { ...w.owner, role: 'guest', actingUser: { id: member.id } };
    expect((await propsRoute.GET()).status).toBe(403);
    session.user = { ...w.owner, role: 'owner' };
    // Lo que no existe o está oculto no se fija.
    const res = (await (await post({ pinned: ['plan_tier', 'health_score', 'nope', 'internal_sync_key', 'plan_tier'] })).json()) as { pinned: string[] };
    expect(res.pinned).toEqual(['plan_tier', 'health_score']);
    // La sección compacta del chat muestra las fijadas con valor.
    const dto = await chatHubspot(w.owner.id, w.acme.id);
    expect(dto.company?.pinned.map((p) => [p.label, p.value])).toEqual([['Plan', 'growth'], ['Health score', '82']]);
    expect(dto.company?.pinned[0].options).toEqual([{ label: 'Growth', value: 'growth' }]);
    // Vacío vuelve a las de siempre.
    expect(await setHubspotPinned(w.owner.id, [])).toEqual(['domain', 'hubspot_owner_id', 'lifecyclestage']);
    expect((await chatHubspot(w.owner.id, w.acme.id)).company?.pinned.find((p) => p.name === 'hubspot_owner_id')?.ownerName).toBe('Paula Ortiz');
  });

  it('los permisos que se piden: leer el esquema es obligatorio; escribir empresas, aparte', async () => {
    expect(HUBSPOT_SCOPES.read).toEqual(['crm.objects.companies.read', 'crm.objects.deals.read', 'crm.objects.contacts.read', 'crm.schemas.companies.read']);
    expect(HUBSPOT_SCOPES.sync).toEqual(['crm.objects.companies.write']);
    expect(HUBSPOT_SCOPES.optional).toEqual(['crm.objects.owners.read']);
    const ws = await makeUser('hs-scopes');
    await expect(connectHubspot(ws.id, ws.id, 'pat-noscope')).rejects.toMatchObject({ code: expect.stringContaining('crm.schemas.companies.read') });
    const dto = await connectHubspot(ws.id, ws.id, 'pat-readonly-sync');
    expect(dto.missingSyncScopes).toEqual(['crm.objects.companies.write']);
    expect((await getHubspotSchema(ws.id)).canWrite).toBe(false);
  });
});

describe('HubSpot: valores de las empresas', () => {
  it('vincular trae todas las propiedades; dos chats de la misma empresa comparten una fila', async () => {
    const w = await world('hs-values');
    const second = await group(w.owner.id, w.row, 'Acme Logistics facturación');
    await linkHubspot(w.owner.id, w.owner.id, second.id, 'company', '9001');
    const rows = (await getDb().prepare('SELECT company_id FROM groups_hubspot_companies WHERE user_id = ? ORDER BY company_id').all(w.owner.id)) as Array<{ company_id: string }>;
    expect(rows.map((r) => r.company_id)).toEqual(['9001', '9002']);
    const a = await chatCompany(w.owner.id, w.acme.id, { refresh: 'none' });
    const b = await chatCompany(w.owner.id, second.id, { refresh: 'none' });
    expect(a.company).toMatchObject({ id: '9001', name: 'Acme Logistics', url: 'https://app.hubspot.com/contacts/424242/record/0-2/9001', broken: null });
    expect(a.values).toEqual(b.values);
    expect(a.values).toMatchObject({ name: 'Acme Logistics', industry: 'TRANSPORTATION', numberofemployees: '250', plan_tier: 'growth', renewal_date: '2027-03-01', products_used: 'inbox;broadcasts', internal_sync_key: 'acme-001' });
    // Los vacíos no se guardan.
    expect(a.values.csm_notes).toBeUndefined();
    expect(a.syncedAt).toBeTruthy();
    // La proyección para filtrar: una fila por propiedad con valor, sin las ocultas, con el número para comparar.
    const proj = (await getDb().prepare("SELECT name, value, num FROM groups_hubspot_values WHERE user_id = ? AND company_id = '9001'").all(w.owner.id)) as Array<{ name: string; value: string; num: number | null }>;
    const by = new Map(proj.map((r) => [r.name, r]));
    expect(by.has('internal_sync_key')).toBe(false);
    expect(by.get('numberofemployees')).toMatchObject({ value: '250', num: 250 });
    expect(by.get('renewal_date')?.num).toBe(Date.parse('2027-03-01T00:00:00Z'));
    expect(by.get('industry')?.num).toBeNull();
  });

  it('lee de a 100 empresas por llamada', async () => {
    const w = await world('hs-batch');
    const fake = fakeHubspot();
    const ids: string[] = [];
    for (let i = 0; i < 230; i++) {
      const id = String(20_000 + i);
      ids.push(id);
      fake.companies.set(id, { id, properties: { name: `Cliente ${i}`, hs_object_id: id, hs_lastmodifieddate: '2026-02-01T00:00:00.000Z', health_score: String(i) } });
    }
    fake.calls.length = 0;
    const res = await importHubspotCompanies(w.owner.id, ids, 'poll');
    expect(res).toMatchObject({ read: 230, missing: [] });
    const reads = batchReads();
    expect(reads).toHaveLength(3);
    expect(reads.map((c) => (c.body as { inputs: unknown[] }).inputs.length)).toEqual([100, 100, 30]);
    // Todas las propiedades del esquema van en el pedido.
    expect((reads[0].body as { properties: string[] }).properties).toEqual(expect.arrayContaining(['name', 'plan_tier', 'renewal_date', 'hs_lastmodifieddate']));
    expect((await valuesOf(w.owner.id, '20229')).health_score).toBe('229');
  });

  it('al abrir el panel refresca si la copia tiene más de un minuto, y no antes', async () => {
    const w = await world('hs-open');
    editFakeCompany('9001', { city: 'Córdoba' });
    fakeHubspot().calls.length = 0;
    expect((await chatCompany(w.owner.id, w.acme.id)).values.city).toBe('Rosario');
    expect(batchReads()).toHaveLength(0);
    await getDb().prepare("UPDATE groups_hubspot_companies SET fetched_at = ? WHERE user_id = ? AND company_id = '9001'").run(new Date(Date.now() - 61_000).toISOString(), w.owner.id);
    const dto = await chatCompany(w.owner.id, w.acme.id);
    expect(dto.values.city).toBe('Córdoba');
    expect(batchReads()).toHaveLength(1);
    expect(dto.log[0]).toMatchObject({ direction: 'in', property: 'city', oldValue: 'Rosario', newValue: 'Córdoba', source: 'open' });
    // Si HubSpot no responde, se muestra la copia guardada y se avisa.
    await getDb().prepare("UPDATE groups_hubspot_companies SET fetched_at = ? WHERE user_id = ? AND company_id = '9001'").run(new Date(Date.now() - 61_000).toISOString(), w.owner.id);
    fakeHubspot().rateLimit = 20;
    const stale = await chatCompany(w.owner.id, w.acme.id);
    expect(stale.refreshError).toBe('hubspot_rate_limited');
    expect(stale.values.city).toBe('Córdoba');
  });
});

describe('HubSpot: Lines → HubSpot', () => {
  it('editar una propiedad la escribe en HubSpot en el momento y queda en el registro con quién fue', async () => {
    const w = await world('hs-out');
    fakeHubspot().calls.length = 0;
    const res = await updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'plan_tier', 'scale');
    expect(res.value).toBe('scale');
    expect(patches()).toHaveLength(1);
    expect(patches()[0]).toMatchObject({ path: '/crm/v3/objects/companies/9001', body: { properties: { plan_tier: 'scale' } } });
    expect(fakeHubspot().companies.get('9001')?.properties.plan_tier).toBe('scale');
    expect((await valuesOf(w.owner.id, '9001')).plan_tier).toBe('scale');
    expect(await logOf(w.owner.id, '9001')).toEqual([{ direction: 'out', property: 'plan_tier', old_value: 'growth', new_value: 'scale', actor_id: w.owner.id, source: 'edit' }]);
    // La proyección también: el filtro lo ve en el momento.
    const hit = await listChats(w.owner.id, w.owner.id, { hsProps: [{ name: 'plan_tier', op: 'any_of', values: ['scale'] }] });
    expect(hit.rows.map((r) => r.id)).toEqual([w.acme.id]);
    // El mismo valor no vuelve a llamar a HubSpot.
    await updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'plan_tier', 'scale');
    expect(patches()).toHaveLength(1);
  });

  it('cada tipo se manda como lo espera HubSpot y un valor que no corresponde no sale', async () => {
    const w = await world('hs-types');
    const edit = (name: string, value: unknown) => updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, name, value);
    const remote = () => fakeHubspot().companies.get('9001')!.properties;
    await edit('products_used', ['analytics', 'inbox']);
    expect(remote().products_used).toBe('analytics;inbox');
    await edit('is_strategic', 'false');
    expect(remote().is_strategic).toBe('false');
    await edit('renewal_date', '2027-06-30');
    expect(remote().renewal_date).toBe('2027-06-30');
    await edit('last_review_at', '2026-11-03T15:30');
    expect(remote().last_review_at).toBe(new Date('2026-11-03T15:30').toISOString());
    await edit('numberofemployees', '300');
    expect(remote().numberofemployees).toBe('300');
    await edit('hubspot_owner_id', '72');
    expect(remote().hubspot_owner_id).toBe('72');
    await edit('csm_notes', 'Renueva en marzo.\nPiden más líneas.');
    expect(remote().csm_notes).toBe('Renueva en marzo.\nPiden más líneas.');
    // Vaciar.
    await edit('csm_notes', '');
    expect(remote().csm_notes).toBe('');
    expect((await valuesOf(w.owner.id, '9001')).csm_notes).toBeUndefined();
    // El nombre de la empresa también cambia en la fila de la bandeja.
    await edit('name', 'Acme Logistics SA');
    expect((await listChats(w.owner.id, w.owner.id)).rows.find((r) => r.id === w.acme.id)?.hubspotName).toBe('Acme Logistics SA');
    const before = patches().length;
    for (const [name, value] of [
      ['numberofemployees', 'muchos'],
      ['renewal_date', '30/06/2027'],
      ['plan_tier', 'enterprise'],
      ['products_used', ['inbox', 'nope']],
      ['is_strategic', 'yes'],
      ['hubspot_owner_id', '999'],
    ] as Array<[string, unknown]>) {
      await expect(edit(name, value), name).rejects.toMatchObject({ code: 'hubspot_invalid_value' });
    }
    expect(patches()).toHaveLength(before);
  });

  it('las de solo lectura y las calculadas no se editan; sin permiso de escritura lo dice', async () => {
    const w = await world('hs-readonly');
    fakeHubspot().calls.length = 0;
    await expect(updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'createdate', '2026-01-01T00:00:00Z')).rejects.toMatchObject({ code: 'hubspot_read_only' });
    await expect(updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'seats_per_employee', '1')).rejects.toMatchObject({ code: 'hubspot_read_only' });
    await expect(updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'internal_sync_key', 'x')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.loose.id, 'city', 'x')).rejects.toMatchObject({ code: 'hubspot_not_linked' });
    expect(patches()).toHaveLength(0);
    await connectHubspot(w.owner.id, w.owner.id, 'pat-readonly-edit');
    await expect(updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'city', 'Salta')).rejects.toMatchObject({ code: 'hubspot_missing_scopes:crm.objects.companies.write', status: 403 });
    expect(patches()).toHaveLength(0);
    expect((await valuesOf(w.owner.id, '9001')).city).toBe('Rosario');
  });

  it('si HubSpot rechaza el valor no se guarda nada y la ruta devuelve lo que dijo HubSpot', async () => {
    const w = await world('hs-validation');
    // HubSpot valida algo que acá no se sabe: la propiedad dejó de aceptar esa opción.
    const def = fakeHubspot().companyProps.find((p) => p.name === 'plan_tier')!;
    def.options = def.options!.filter((o) => o.value !== 'scale');
    session.user = { ...w.owner, role: 'owner' };
    const res = await companyRoute.PATCH(new Request('http://x/api/groups/hubspot/company', { method: 'PATCH', body: JSON.stringify({ chatId: w.acme.id, property: 'plan_tier', value: 'scale' }) }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'hubspot_validation', detail: 'scale was not one of the allowed options' });
    expect((await valuesOf(w.owner.id, '9001')).plan_tier).toBe('growth');
    expect(await logOf(w.owner.id, '9001')).toEqual([]);
    expect((await listChats(w.owner.id, w.owner.id, { hsProps: [{ name: 'plan_tier', op: 'any_of', values: ['growth'] }] })).total).toBe(1);
  });
});

describe('HubSpot: HubSpot → Lines', () => {
  it('el cron trae lo que cambió en HubSpot buscando por fecha de modificación entre las empresas vinculadas', async () => {
    const w = await world('hs-in');
    await cron(w.owner.id);
    fakeHubspot().calls.length = 0;
    editFakeCompany('9001', { plan_tier: 'scale', health_score: '91' });
    const res = await cron(w.owner.id, 1);
    expect(res).toMatchObject({ workspaces: 1, imported: 1, changed: 2, missing: 0 });
    const search = searches()[0].body as { filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; values?: string[] }> }> };
    expect(search.filterGroups[0].filters.map((f) => `${f.propertyName} ${f.operator}`)).toEqual(['hs_lastmodifieddate GTE', 'hs_object_id IN']);
    expect(search.filterGroups[0].filters[1].values).toEqual(['9001', '9002']);
    // Solo se lee la que cambió.
    expect(batchReads().map((c) => (c.body as { inputs: unknown[] }).inputs)).toEqual([[{ id: '9001' }]]);
    expect(await valuesOf(w.owner.id, '9001')).toMatchObject({ plan_tier: 'scale', health_score: '91' });
    expect(await logOf(w.owner.id, '9001')).toEqual([
      { direction: 'in', property: 'plan_tier', old_value: 'growth', new_value: 'scale', actor_id: null, source: 'poll' },
      { direction: 'in', property: 'health_score', old_value: '82', new_value: '91', actor_id: null, source: 'poll' },
    ]);
    // Lo que llega de HubSpot nunca se vuelve a mandar.
    expect(patches()).toHaveLength(0);
    expect((await getHubspot(w.owner.id)).syncedAt).toBeTruthy();
    // Otra corrida sin cambios: nada que leer, nada en el registro.
    fakeHubspot().calls.length = 0;
    expect(await cron(w.owner.id, 2)).toMatchObject({ imported: 0, changed: 0 });
    expect(batchReads()).toHaveLength(0);
  });

  it('corre desde el cron de Lines', async () => {
    const w = await world('hs-cron');
    await cron(w.owner.id);
    editFakeCompany('9002', { city: 'Mendoza' });
    await getDb().prepare("UPDATE groups_hubspot SET sync_cursor = json_set(sync_cursor, '$.since', ?) WHERE user_id = ?").run(new Date(Date.now() - 60_000).toISOString(), w.owner.id);
    // Los workspaces de otros tests no entran en esta corrida.
    await getDb().prepare('UPDATE groups_hubspot SET sync_backoff_until = ? WHERE user_id != ?').run(new Date(Date.now() + 3_600_000).toISOString(), w.owner.id);
    const out = await runGroupsCron();
    expect(out.hubspotSync).toMatchObject({ workspaces: 1, changed: 1 });
    expect((await valuesOf(w.owner.id, '9002')).city).toBe('Mendoza');
  });

  it('un cambio que escribimos no vuelve como cambio de HubSpot (sin vuelta)', async () => {
    const w = await world('hs-loop');
    await cron(w.owner.id);
    await updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'city', 'Salta');
    fakeHubspot().calls.length = 0;
    // HubSpot marca la empresa como modificada por nuestra escritura: el cron la lee y no encuentra diferencias.
    const res = await cron(w.owner.id, 1);
    expect(res).toMatchObject({ imported: 1, changed: 0 });
    expect(batchReads()).toHaveLength(1);
    expect(patches()).toHaveLength(0);
    expect((await logOf(w.owner.id, '9001')).map((l) => `${l.direction} ${l.property}`)).toEqual(['out city']);
    // Y al revés: lo que entra de HubSpot no dispara una escritura.
    editFakeCompany('9001', { city: 'Jujuy' });
    await cron(w.owner.id, 2);
    await cron(w.owner.id, 3);
    expect(patches()).toHaveLength(0);
    expect((await logOf(w.owner.id, '9001')).map((l) => `${l.direction} ${l.property} ${l.new_value}`)).toEqual(['out city Salta', 'in city Jujuy']);
  });

  it('conflictos: gana la última escritura, por propiedad', async () => {
    const w = await world('hs-conflict');
    const { updatedAt } = await updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'city', 'Salta');
    const wrote = Date.parse(updatedAt);
    // Una lectura anterior a nuestra escritura (en vuelo cuando editamos): trae la ciudad vieja y otro cambio.
    const older = new Date(wrote - 5_000).toISOString();
    expect(await applyHubspotSnapshot(w.owner.id, '9001', { city: 'Rosario', health_score: '70' }, older, 'poll')).toBe(1);
    const mid = await valuesOf(w.owner.id, '9001');
    // La ciudad queda como la escribimos; la otra propiedad, que no tocamos, entra.
    expect(mid.city).toBe('Salta');
    expect(mid.health_score).toBe('70');
    // Una lectura posterior con otra ciudad: alguien la cambió en HubSpot después. Gana HubSpot.
    const newer = new Date(wrote + 5_000).toISOString();
    expect(await applyHubspotSnapshot(w.owner.id, '9001', { city: 'Tucumán' }, newer, 'poll')).toBe(1);
    expect((await valuesOf(w.owner.id, '9001')).city).toBe('Tucumán');
    expect((await logOf(w.owner.id, '9001')).map((l) => `${l.direction} ${l.property} ${l.old_value}>${l.new_value}`)).toEqual(['out city Rosario>Salta', 'in health_score 82>70', 'in city Salta>Tucumán']);
    // Editar desde Lines después de un cambio de HubSpot: es la última escritura y llega a HubSpot.
    await updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'city', 'Salta');
    expect(fakeHubspot().companies.get('9001')?.properties.city).toBe('Salta');
    const dto = await chatCompany(w.owner.id, w.acme.id, { refresh: 'none' });
    expect(Date.parse(dto.times.city)).toBeGreaterThan(wrote);
  });

  it('la contabilidad de HubSpot (solo lectura, del sistema) se guarda pero no llena el registro', async () => {
    const w = await world('hs-noise');
    await cron(w.owner.id);
    editFakeCompany('9001', {});
    await cron(w.owner.id, 1);
    expect(await logOf(w.owner.id, '9001')).toEqual([]);
    expect((await valuesOf(w.owner.id, '9001')).hs_lastmodifieddate).toBe(fakeHubspot().companies.get('9001')?.properties.hs_lastmodifieddate);
  });

  it('una empresa borrada o fusionada deja el vínculo roto con aviso y el sync sigue con las demás', async () => {
    const w = await world('hs-gone');
    const third = await group(w.owner.id, w.row, 'Initech Foods');
    await linkHubspot(w.owner.id, w.owner.id, third.id, 'company', '9003');
    await cron(w.owner.id);
    fakeHubspot().companies.delete('9001');
    mergeFakeCompanies('9003', '9002');
    editFakeCompany('9002', { city: 'Lima' });
    // La verificación completa corre una vez por hora.
    await getDb().prepare('UPDATE groups_hubspot SET verified_at = ? WHERE user_id = ?').run(new Date(Date.now() - 2 * 3_600_000).toISOString(), w.owner.id);
    const res = await cron(w.owner.id, 1);
    expect(res.missing).toBe(2);
    expect((await valuesOf(w.owner.id, '9002')).city).toBe('Lima');
    const gone = await chatCompany(w.owner.id, w.acme.id, { refresh: 'none' });
    expect(gone.company?.broken).toEqual({ reason: 'deleted', mergedInto: '', mergedName: '' });
    const merged = await chatCompany(w.owner.id, third.id, { refresh: 'none' });
    expect(merged.company?.broken).toEqual({ reason: 'merged', mergedInto: '9002', mergedName: 'Globex Retail' });
    expect((await chatHubspot(w.owner.id, w.acme.id)).company?.broken?.reason).toBe('deleted');
    // Sus valores ya no entran en los filtros y no se puede editar.
    expect((await listChats(w.owner.id, w.owner.id, { hsProps: [{ name: 'name', op: 'not_empty' }] })).rows.map((r) => r.id)).toEqual([w.globex.id]);
    expect((await listChats(w.owner.id, w.owner.id, { hsProps: [{ name: 'city', op: 'empty' }] })).total).toBe(0);
    await expect(updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'city', 'x')).rejects.toMatchObject({ code: 'hubspot_company_gone' });
    // El cron sigue andando con el vínculo roto.
    editFakeCompany('9002', { city: 'Quito' });
    await cron(w.owner.id, 2);
    expect((await valuesOf(w.owner.id, '9002')).city).toBe('Quito');
    // Vincular el grupo a la empresa que quedó lo arregla.
    await linkHubspot(w.owner.id, w.owner.id, third.id, 'company', '9002');
    expect((await chatCompany(w.owner.id, third.id, { refresh: 'none' })).company).toMatchObject({ id: '9002', broken: null });
  });

  it('editar una empresa que borraron en HubSpot marca el vínculo y lo dice', async () => {
    const w = await world('hs-gone-edit');
    fakeHubspot().companies.delete('9001');
    await expect(updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'city', 'Salta')).rejects.toMatchObject({ code: 'hubspot_company_gone', status: 409 });
    expect((await chatCompany(w.owner.id, w.acme.id, { refresh: 'none' })).company?.broken?.reason).toBe('deleted');
  });

  it('retoma donde quedó: con muchas empresas busca de a 100 y guarda el cursor', async () => {
    const w = await world('hs-resume');
    const fake = fakeHubspot();
    const db = getDb();
    for (let i = 0; i < 150; i++) {
      const id = String(30_000 + i);
      fake.companies.set(id, { id, properties: { name: `Cuenta ${i}`, hs_object_id: id, hs_lastmodifieddate: '2026-02-01T00:00:00.000Z' } });
      const g = await group(w.owner.id, w.row, `Cuenta ${i} ${w.owner.id}`);
      await db
        .prepare("INSERT INTO groups_hubspot_links (chat_id, user_id, object_type, object_id, name, props, missing, created_at) VALUES (?, ?, 'company', ?, ?, '{}', 0, ?)")
        .run(g.id, w.owner.id, id, `Cuenta ${i}`, new Date().toISOString());
    }
    // Sin presupuesto no avanza y no rompe nada.
    expect(await syncHubspotCompanies({ workspaceId: w.owner.id, budgetMs: -1 })).toMatchObject({ workspaces: 0 });
    fake.calls.length = 0;
    // Primera corrida: importa las 150 que no tenían copia (2 lecturas) y recorre las 152 en 2 búsquedas.
    expect(await cron(w.owner.id)).toMatchObject({ imported: 150 });
    expect(batchReads()).toHaveLength(2);
    expect(searches().map((c) => (c.body as { filterGroups: Array<{ filters: Array<{ values?: string[] }> }> }).filterGroups[0].filters[1].values?.length)).toEqual([100, 52]);
    const cursor = JSON.parse(((await db.prepare('SELECT sync_cursor FROM groups_hubspot WHERE user_id = ?').get(w.owner.id)) as { sync_cursor: string }).sync_cursor) as { since: string; idx: number };
    expect(cursor.idx).toBe(0);
    expect(Date.parse(cursor.since)).toBeLessThanOrEqual(Date.now());
    // Un cambio en la segunda tanda llega igual.
    editFakeCompany('30149', { name: 'Cuenta renombrada' });
    await cron(w.owner.id, 1);
    expect((await valuesOf(w.owner.id, '30149')).name).toBe('Cuenta renombrada');
  });
});

describe('HubSpot: límite de llamadas', () => {
  it('ante un 429 espera y reintenta; la edición sale igual', async () => {
    const w = await world('hs-429');
    fakeHubspot().calls.length = 0;
    fakeHubspot().rateLimit = 2;
    await updateHubspotCompanyProperty(w.owner.id, w.owner.id, w.acme.id, 'city', 'Salta');
    expect(patches()).toHaveLength(3);
    expect(fakeHubspot().companies.get('9001')?.properties.city).toBe('Salta');
  });

  it('si el límite sigue, ese workspace espera cada vez más y los demás sincronizan', async () => {
    const a = await world('hs-429-a');
    const b = await world('hs-429-b');
    await cron(a.owner.id);
    await cron(b.owner.id);
    editFakeCompany('9001', { city: 'Salta' });
    fakeHubspot().rateLimit = 4;
    const res = await cron(a.owner.id, 1);
    expect(res).toMatchObject({ workspaces: 1, limited: 1, changed: 0 });
    // El otro workspace sincroniza en la misma pasada del cron.
    expect(await cron(b.owner.id, 1)).toMatchObject({ workspaces: 1, limited: 0, changed: 1 });
    expect((await valuesOf(b.owner.id, '9001')).city).toBe('Salta');
    const state = async () => (await getDb().prepare('SELECT sync_fails, sync_backoff_until, sync_locked_until, last_error FROM groups_hubspot WHERE user_id = ?').get(a.owner.id)) as {
      sync_fails: number;
      sync_backoff_until: string | null;
      sync_locked_until: string | null;
      last_error: string;
    };
    expect(await state()).toMatchObject({ sync_fails: 1, sync_locked_until: null, last_error: 'hubspot_rate_limited' });
    expect(Date.parse((await state()).sync_backoff_until!)).toBeGreaterThan(Date.now() + 60_000);
    // Mientras espera, el cron no lo toca.
    fakeHubspot().rateLimit = 0;
    fakeHubspot().calls.length = 0;
    expect(await cron(a.owner.id, 1)).toMatchObject({ workspaces: 0 });
    expect(fakeHubspot().calls).toHaveLength(0);
    // Pasada la espera, sincroniza y vuelve a cero.
    expect(await cron(a.owner.id, 3)).toMatchObject({ workspaces: 1, changed: 1 });
    expect(await state()).toMatchObject({ sync_fails: 0, sync_backoff_until: null });
    expect((await valuesOf(a.owner.id, '9001')).city).toBe('Salta');
  });
});

describe('HubSpot: filtro de la bandeja por propiedades', () => {
  async function filterWorld(label: string) {
    const w = await world(label);
    const initech = await group(w.owner.id, w.row, `Initech ${label}`);
    await linkHubspot(w.owner.id, w.owner.id, initech.id, 'company', '9003');
    const names = new Map([
      [w.acme.id, 'acme'],
      [w.globex.id, 'globex'],
      [initech.id, 'initech'],
      [w.loose.id, 'loose'],
    ]);
    const run = async (...hsProps: HubspotPropFilter[]) => (await listChats(w.owner.id, w.owner.id, { hsProps })).rows.map((r) => names.get(r.id)).sort();
    return { ...w, initech, run };
  }

  it('cada operador, en SQL contra la proyección local', async () => {
    const { run } = await filterWorld('hs-filter');
    // Texto.
    expect(await run({ name: 'name', op: 'is', value: 'acme logistics' })).toEqual(['acme']);
    expect(await run({ name: 'name', op: 'is_not', value: 'Acme Logistics' })).toEqual(['globex', 'initech']);
    expect(await run({ name: 'domain', op: 'contains', value: 'retail' })).toEqual(['globex']);
    expect(await run({ name: 'domain', op: 'contains', value: '100%_' })).toEqual([]);
    expect(await run({ name: 'city', op: 'empty' })).toEqual(['globex', 'initech']);
    expect(await run({ name: 'city', op: 'not_empty' })).toEqual(['acme']);
    // Número.
    expect(await run({ name: 'numberofemployees', op: 'gt', value: '100' })).toEqual(['acme', 'initech']);
    expect(await run({ name: 'numberofemployees', op: 'lt', value: '100' })).toEqual(['globex']);
    expect(await run({ name: 'numberofemployees', op: 'is', value: '250' })).toEqual(['acme']);
    expect(await run({ name: 'numberofemployees', op: 'is_not', value: '250' })).toEqual(['globex', 'initech']);
    expect(await run({ name: 'health_score', op: 'gt', value: '60' })).toEqual(['acme']);
    expect(await run({ name: 'health_score', op: 'empty' })).toEqual(['initech']);
    // Fecha: antes, después y ese día.
    expect(await run({ name: 'renewal_date', op: 'gt', value: '2026-12-31' })).toEqual(['acme']);
    expect(await run({ name: 'renewal_date', op: 'lt', value: '2026-12-31' })).toEqual(['globex']);
    expect(await run({ name: 'renewal_date', op: 'is', value: '2026-12-10' })).toEqual(['globex']);
    expect(await run({ name: 'renewal_date', op: 'gt', value: '2026-12-10' })).toEqual(['acme']);
    expect(await run({ name: 'createdate', op: 'is', value: '2026-01-15' })).toEqual(['acme', 'globex', 'initech']);
    // Selección: cualquiera de, ninguna de.
    expect(await run({ name: 'plan_tier', op: 'any_of', values: ['growth', 'scale'] })).toEqual(['acme']);
    expect(await run({ name: 'plan_tier', op: 'any_of', values: ['growth', 'starter'] })).toEqual(['acme', 'globex']);
    expect(await run({ name: 'plan_tier', op: 'none_of', values: ['growth'] })).toEqual(['globex', 'initech']);
    expect(await run({ name: 'hubspot_owner_id', op: 'any_of', values: ['72'] })).toEqual(['globex']);
    expect(await run({ name: 'is_strategic', op: 'any_of', values: ['true'] })).toEqual(['acme']);
    // Selección múltiple: alguna de las elegidas, sin confundir "inbox" con otra que la contenga.
    expect(await run({ name: 'products_used', op: 'any_of', values: ['broadcasts'] })).toEqual(['acme']);
    expect(await run({ name: 'products_used', op: 'any_of', values: ['inbox'] })).toEqual(['acme', 'globex']);
    expect(await run({ name: 'products_used', op: 'any_of', values: ['box'] })).toEqual([]);
    expect(await run({ name: 'products_used', op: 'none_of', values: ['broadcasts'] })).toEqual(['globex', 'initech']);
    // Varias condiciones se suman.
    expect(await run({ name: 'numberofemployees', op: 'gt', value: '100' }, { name: 'plan_tier', op: 'empty' })).toEqual(['initech']);
    // Una propiedad que no existe, o un valor que no es un número, no devuelve nada (y no rompe).
    expect(await run({ name: 'nope', op: 'not_empty' })).toEqual([]);
    expect(await run({ name: 'numberofemployees', op: 'gt', value: 'abc' })).toEqual([]);
    // El chat sin empresa nunca entra, ni en los negativos.
    expect(await run({ name: 'name', op: 'is_not', value: 'zzz' })).not.toContain('loose');
  });

  it('se combina con los demás filtros, se guarda en las listas y llega por la URL', async () => {
    const w = await filterWorld('hs-filter-lists');
    const filters = cleanListFilters({ kind: 'group', hsProps: [{ name: 'plan_tier', op: 'any_of', values: ['starter', 'starter', ''] }, { name: 'bad name!', op: 'is', value: 'x' }, { name: 'city', op: 'is' }, { name: 'city', op: 'wat', value: 'x' }] });
    expect(filters).toEqual({ kinds: ['group'], hsProps: [{ name: 'plan_tier', op: 'any_of', values: ['starter'] }] });
    expect((await listChats(w.owner.id, w.owner.id, listQuery(filters))).rows.map((r) => r.id)).toEqual([w.globex.id]);
    expect(parseHubspotFilterParam('not json')).toEqual([]);
    expect(cleanHubspotFilters(Array.from({ length: 9 }, () => ({ name: 'city', op: 'empty' })))).toHaveLength(5);
    session.user = { ...w.owner, role: 'owner' };
    const hs = encodeURIComponent(JSON.stringify([{ name: 'industry', op: 'any_of', values: ['RETAIL', 'FOOD_PRODUCTION'] }]));
    const res = (await (await chatsRoute.GET(new Request(`http://x/api/groups/chats?hs=${hs}`))).json()) as { rows: Array<{ id: string }>; total: number };
    expect(res.rows.map((r) => r.id).sort()).toEqual([w.globex.id, w.initech.id].sort());
    expect(res.total).toBe(2);
    // Con otro filtro encima.
    const none = (await (await chatsRoute.GET(new Request(`http://x/api/groups/chats?hs=${hs}&filter=unassigned&kind=dm`))).json()) as { total: number };
    expect(none.total).toBe(0);
  });

  it('quien no ve una línea no recibe sus chats por un filtro de HubSpot; otro workspace no ve los valores', async () => {
    const w = await filterWorld('hs-filter-access');
    const hidden = await line(w.owner.id, 'Reservada');
    const secret = await group(w.owner.id, hidden, 'Acme directorio');
    await linkHubspot(w.owner.id, w.owner.id, secret.id, 'company', '9001');
    const team = await createTeam(w.owner.id, 'Workspace');
    const ruth = await makeUser('hs-filter-ruth');
    await addMember(team.id, ruth.id, 'member');
    await setLineAccess(w.owner.id, hidden.id, { ownerId: w.owner.id, visibility: 'restricted', personIds: [], teamIds: [] });
    const filter: HubspotPropFilter[] = [{ name: 'plan_tier', op: 'any_of', values: ['growth'] }];
    // El dueño ve los dos chats de Acme.
    expect((await listChats(w.owner.id, w.owner.id, { hsProps: filter, viewer: systemViewer(w.owner.id) })).rows.map((r) => r.id).sort()).toEqual([w.acme.id, secret.id].sort());
    // Ruth no ve la línea reservada: el filtro le devuelve solo el de la línea abierta.
    const viewer = await groupsViewer(w.owner.id, ruth.id, 'member');
    const seen = await listChats(w.owner.id, ruth.id, { hsProps: filter, viewer });
    expect(seen.rows.map((r) => r.id)).toEqual([w.acme.id]);
    expect(seen.total).toBe(1);
    expect((await listChats(w.owner.id, ruth.id, { hsProps: [{ name: 'city', op: 'empty' }, { name: 'name', op: 'is_not', value: 'x' }], viewer })).rows.map((r) => r.id)).not.toContain(secret.id);
    // Con acceso por etiqueta y sin etiquetas, no ve ninguno.
    await updatePlatformSettings(w.owner.id, { labelAccess: true });
    expect((await listChats(w.owner.id, ruth.id, { hsProps: filter, viewer: await groupsViewer(w.owner.id, ruth.id, 'member') })).total).toBe(0);
    // Por la ruta, igual; y tampoco abre la pantalla ni edita ese chat.
    await updatePlatformSettings(w.owner.id, { labelAccess: false });
    session.user = { ...w.owner, role: 'member', actingUser: { id: ruth.id } };
    const hs = encodeURIComponent(JSON.stringify(filter));
    expect(((await (await chatsRoute.GET(new Request(`http://x/api/groups/chats?hs=${hs}`))).json()) as { rows: Array<{ id: string }> }).rows.map((r) => r.id)).toEqual([w.acme.id]);
    expect((await companyRoute.GET(new Request(`http://x/api/groups/hubspot/company?chat=${secret.id}`))).status).toBe(404);
    const patch = (chatId: string) => companyRoute.PATCH(new Request('http://x/api/groups/hubspot/company', { method: 'PATCH', body: JSON.stringify({ chatId, property: 'city', value: 'Salta' }) }));
    expect((await patch(secret.id)).status).toBe(404);
    expect((await companyRoute.POST(new Request('http://x/api/groups/hubspot/company', { method: 'POST', body: JSON.stringify({ chatId: secret.id }) }))).status).toBe(404);
    expect((await patch(w.acme.id)).status).toBe(200);
    // Un invitado mira y no edita.
    session.user = { ...w.owner, role: 'guest', actingUser: { id: ruth.id } };
    expect((await patch(w.acme.id)).status).toBe(403);

    // Otro workspace con la misma cuenta de HubSpot y sus propios valores.
    const other = await world('hs-filter-other');
    const mine = await listChats(other.owner.id, other.owner.id, { hsProps: filter });
    expect(mine.rows.map((r) => r.id)).toEqual([other.acme.id]);
    // Sus filtros no alcanzan chats del primero y no puede abrir sus empresas.
    session.user = { ...other.owner, role: 'owner' };
    expect((await companyRoute.GET(new Request(`http://x/api/groups/hubspot/company?chat=${w.acme.id}`))).status).toBe(404);
    expect((await patch(w.acme.id)).status).toBe(404);
    // Editar en uno no cambia la copia del otro hasta que HubSpot la traiga.
    await updateHubspotCompanyProperty(other.owner.id, other.owner.id, other.acme.id, 'plan_tier', 'scale');
    expect((await listChats(w.owner.id, w.owner.id, { hsProps: filter })).total).toBe(2);
    expect((await listChats(other.owner.id, other.owner.id, { hsProps: filter })).total).toBe(0);
  });

  it('desconectado, el filtro no devuelve nada', async () => {
    const w = await filterWorld('hs-filter-off');
    await disconnectHubspot(w.owner.id);
    expect(await w.run({ name: 'name', op: 'not_empty' })).toEqual([]);
  });

  it('quien tiene los teléfonos ocultos no ve ni edita el teléfono de la empresa', async () => {
    const w = await world('hs-mask');
    const team = await createTeam(w.owner.id, 'Workspace');
    const ruth = await makeUser('hs-mask-ruth');
    await addMember(team.id, ruth.id, 'member');
    await updatePlatformSettings(w.owner.id, { maskRoles: ['member'] });
    session.user = { ...w.owner, role: 'member', actingUser: { id: ruth.id } };
    const dto = (await (await companyRoute.GET(new Request(`http://x/api/groups/hubspot/company?chat=${w.acme.id}`))).json()) as { values: Record<string, string> };
    expect(dto.values.phone).toBe('•••');
    expect(dto.values.city).toBe('Rosario');
    const res = await companyRoute.PATCH(new Request('http://x/api/groups/hubspot/company', { method: 'PATCH', body: JSON.stringify({ chatId: w.acme.id, property: 'phone', value: '1' }) }));
    expect(res.status).toBe(403);
  });

  it('operadores por tipo y formato de valores', () => {
    expect(hubspotOpsFor('text')).toEqual(['is', 'is_not', 'contains', 'empty', 'not_empty']);
    expect(hubspotOpsFor('number')).toEqual(['is', 'is_not', 'gt', 'lt', 'empty', 'not_empty']);
    expect(hubspotOpsFor('date')).toEqual(['is', 'gt', 'lt', 'empty', 'not_empty']);
    expect(hubspotOpsFor('multi')).toEqual(['any_of', 'none_of', 'empty', 'not_empty']);
    const f = { locale: 'en', owners: [{ id: '71', name: 'Paula Ortiz' }], yes: 'Yes', no: 'No' };
    const opts = [{ label: 'Inbox', value: 'inbox' }, { label: 'Broadcasts', value: 'broadcasts' }];
    expect(formatHubspotValue({ kind: 'multi', options: opts }, 'inbox;broadcasts', f)).toBe('Inbox, Broadcasts');
    expect(formatHubspotValue({ kind: 'select', options: opts }, 'gone', f)).toBe('gone');
    expect(formatHubspotValue({ kind: 'owner', options: [] }, '71', f)).toBe('Paula Ortiz');
    expect(formatHubspotValue({ kind: 'bool', options: [] }, 'true', f)).toBe('Yes');
    expect(formatHubspotValue({ kind: 'number', options: [] }, '12000', f)).toBe('12,000');
    expect(formatHubspotValue({ kind: 'date', options: [] }, '2027-03-01', f)).toBe('Mar 1, 2027');
  });
});

describe('HubSpot: webhook', () => {
  const SECRET = 'fake-client-secret-for-tests';
  const URL_ = 'http://x/api/groups/hubspot/webhook';
  const send = (body: string, secret = SECRET, timestamp = String(Date.now())) =>
    webhookRoute.POST(
      new Request(URL_, {
        method: 'POST',
        body,
        headers: { 'x-hubspot-signature-v3': hubspotSignatureV3(secret, 'POST', URL_, body, timestamp), 'x-hubspot-request-timestamp': timestamp },
      }),
    );

  it('con la firma válida vuelve a leer las empresas nombradas; sin firma válida es un 401', async () => {
    const w = await world('hs-webhook');
    vi.stubEnv('GROUPS_WEBHOOK_BASE_URL', 'http://x');
    const body = JSON.stringify([{ eventId: 1, portalId: 424242, subscriptionType: 'company.propertyChange', objectId: 9001, propertyName: 'city', propertyValue: 'ignored' }]);
    editFakeCompany('9001', { city: 'Posadas' });
    // Sin secreto guardado no hay cómo validar.
    expect((await send(body)).status).toBe(401);
    await updateHubspotSettings(w.owner.id, { webhookSecret: SECRET });
    const dto = await getHubspot(w.owner.id);
    expect(dto.webhook).toBe(true);
    expect(JSON.stringify(dto)).not.toContain(SECRET);
    expect((await send(body, 'another-secret')).status).toBe(401);
    expect((await send(body, SECRET, String(Date.now() - 10 * 60_000))).status).toBe(401);
    expect((await valuesOf(w.owner.id, '9001')).city).toBe('Rosario');
    expect((await send(body)).status).toBe(200);
    // El valor sale de HubSpot, no del aviso.
    expect((await valuesOf(w.owner.id, '9001')).city).toBe('Posadas');
    expect((await logOf(w.owner.id, '9001')).at(-1)).toMatchObject({ direction: 'in', property: 'city', new_value: 'Posadas', source: 'webhook' });
    // Un borrado avisado marca el vínculo.
    fakeHubspot().companies.delete('9002');
    expect((await send(JSON.stringify([{ portalId: 424242, subscriptionType: 'company.deletion', objectId: 9002 }]))).status).toBe(200);
    expect((await chatCompany(w.owner.id, w.globex.id, { refresh: 'none' })).company?.broken?.reason).toBe('deleted');
    // Empresas que no están vinculadas no se leen.
    fakeHubspot().calls.length = 0;
    const res = await handleHubspotWebhook({ method: 'POST', urls: [URL_], body: JSON.stringify([{ portalId: 424242, subscriptionType: 'company.propertyChange', objectId: 9003 }]), timestamp: String(Date.now()), signature: hubspotSignatureV3(SECRET, 'POST', URL_, JSON.stringify([{ portalId: 424242, subscriptionType: 'company.propertyChange', objectId: 9003 }]), String(Date.now())) });
    expect(res === null || res.refreshed === 0).toBe(true);
    expect(batchReads()).toHaveLength(0);
    // Desconectar borra el secreto.
    await disconnectHubspot(w.owner.id);
    expect((await send(body)).status).toBe(401);
  });
});

describe('HubSpot: grupos sin empresa', () => {
  it('parecido de nombres: propone solo cuando el nombre de la empresa está en el del grupo', () => {
    expect(nameSimilarity('Acme Logistics soporte', 'Acme Logistics')).toBeGreaterThanOrEqual(0.9);
    expect(nameSimilarity('Soporte Globex', 'Globex Retail')).toBeGreaterThanOrEqual(0.6);
    expect(nameSimilarity('GLOBEX RETAIL - Ventas', 'Globex Retail')).toBeGreaterThanOrEqual(0.9);
    expect(nameSimilarity('Initech Fóods S.A.', 'Initech Foods')).toBeGreaterThanOrEqual(0.9);
    expect(nameSimilarity('Proveedores', 'Acme Logistics')).toBeLessThan(0.6);
    expect(nameSimilarity('Grupo soporte', 'Support Group Inc')).toBe(0);
  });

  it('lista los grupos sin empresa, sugiere por nombre y no vincula nada sin confirmación', async () => {
    const w = await world('hs-unlinked');
    const retail = await group(w.owner.id, w.row, 'Globex Retail - Ventas');
    const initech = await group(w.owner.id, w.row, 'Equipo Initech Foods');
    session.user = { ...w.owner, role: 'owner' };
    const get = async (qs = '') => (await (await unlinkedRoute.GET(new Request(`http://x/api/groups/hubspot/unlinked${qs}`))).json()) as { connected: boolean; total: number; rows: Array<{ id: string; name: string; pending: boolean; suggestion: { id: string; name: string } | null }> };
    const first = await get();
    expect(first.connected).toBe(true);
    // Los dos ya vinculados no están.
    expect(first.rows.map((r) => r.id).sort()).toEqual([w.loose.id, retail.id, initech.id].sort());
    expect(first.total).toBe(3);
    expect(first.rows.every((r) => r.pending && r.suggestion === null)).toBe(true);
    const post = await unlinkedRoute.POST(new Request('http://x/api/groups/hubspot/unlinked', { method: 'POST', body: JSON.stringify({ chatIds: first.rows.map((r) => r.id) }) }));
    const { suggestions } = (await post.json()) as { suggestions: Record<string, { id: string; name: string; score: number } | null> };
    expect(suggestions[retail.id]).toMatchObject({ id: '9002', name: 'Globex Retail' });
    expect(suggestions[initech.id]).toMatchObject({ id: '9003', name: 'Initech Foods' });
    expect(suggestions[w.loose.id]).toBeNull();
    // Solo sugiere: nadie quedó vinculado.
    const links = (await getDb().prepare('SELECT chat_id FROM groups_hubspot_links WHERE user_id = ?').all(w.owner.id)) as Array<{ chat_id: string }>;
    expect(links.map((l) => l.chat_id).sort()).toEqual([w.acme.id, w.globex.id].sort());
    // La sugerencia queda guardada: la segunda vez no busca.
    fakeHubspot().calls.length = 0;
    const second = await get();
    expect(second.rows.find((r) => r.id === retail.id)).toMatchObject({ pending: false, suggestion: { id: '9002', name: 'Globex Retail' } });
    expect(second.rows.find((r) => r.id === w.loose.id)).toMatchObject({ pending: false, suggestion: null });
    expect(fakeHubspot().calls).toHaveLength(0);
    expect((await get('?q=initech')).rows.map((r) => r.id)).toEqual([initech.id]);
    // Confirmar una sugerencia la saca de la lista.
    await linkHubspot(w.owner.id, w.owner.id, retail.id, 'company', '9002');
    expect((await get()).rows.map((r) => r.id).sort()).toEqual([w.loose.id, initech.id].sort());
  });

  it('solo aparecen los grupos de las líneas que la persona ve, y no sugiere para los que no ve', async () => {
    const w = await world('hs-unlinked-access');
    const hidden = await line(w.owner.id, 'Reservada');
    const secret = await group(w.owner.id, hidden, 'Initech Foods directorio');
    const team = await createTeam(w.owner.id, 'Workspace');
    const ruth = await makeUser('hs-unlinked-ruth');
    await addMember(team.id, ruth.id, 'member');
    await setLineAccess(w.owner.id, hidden.id, { ownerId: w.owner.id, visibility: 'restricted', personIds: [], teamIds: [] });
    const viewer = await groupsViewer(w.owner.id, ruth.id, 'member');
    expect((await listUnlinkedGroups(w.owner.id, viewer)).rows.map((r) => r.id)).toEqual([w.loose.id]);
    expect((await listUnlinkedGroups(w.owner.id, systemViewer(w.owner.id))).rows.map((r) => r.id).sort()).toEqual([w.loose.id, secret.id].sort());
    session.user = { ...w.owner, role: 'member', actingUser: { id: ruth.id } };
    fakeHubspot().calls.length = 0;
    const res = await unlinkedRoute.POST(new Request('http://x/api/groups/hubspot/unlinked', { method: 'POST', body: JSON.stringify({ chatIds: [secret.id] }) }));
    expect(await res.json()).toEqual({ suggestions: {} });
    expect(searches()).toHaveLength(0);
    // Los ids de otro workspace tampoco.
    expect(await suggestCompaniesForGroups((await makeUser('hs-unlinked-x')).id, [secret.id]).catch((e: { code: string }) => e.code)).toBe('hubspot_not_connected');
  });
});

describe('HubSpot falso: la ruta de tests', () => {
  it('fuera del modo falso es un 404; adentro edita el HubSpot en memoria', async () => {
    const w = await world('hs-fake-route');
    session.user = { ...w.owner, role: 'owner' };
    const post = (body: unknown) => fakeRoute.POST(new Request('http://x/api/groups/hubspot/fake', { method: 'POST', body: JSON.stringify(body) }));
    expect((await post({ company: '9001', properties: { city: 'Bariloche' } })).status).toBe(200);
    expect(((await (await fakeRoute.GET(new Request('http://x/api/groups/hubspot/fake?company=9001'))).json()) as { properties: Record<string, string> }).properties.city).toBe('Bariloche');
    expect((await post({ company: '1', properties: {} })).status).toBe(400);
    vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '');
    vi.stubEnv('GROUPS_FAKE', '');
    expect((await post({ company: '9001', properties: { city: 'x' } })).status).toBe(404);
    expect((await fakeRoute.GET(new Request('http://x/api/groups/hubspot/fake?company=9001'))).status).toBe(404);
    expect(fakeHubspot().companies.get('9001')?.properties.city).toBe('Bariloche');
  });

  it('el esquema se puede volver a importar sin duplicar ni perder los valores', async () => {
    const w = await world('hs-reimport');
    await refreshHubspotSchema(w.owner.id);
    await refreshHubspotSchema(w.owner.id);
    const n = (await getDb().prepare('SELECT COUNT(*) AS n FROM groups_hubspot_props WHERE user_id = ? AND archived = 0').get(w.owner.id)) as { n: number };
    expect(Number(n.n)).toBe(fakeHubspot().companyProps.length);
    expect((await valuesOf(w.owner.id, '9001')).plan_tier).toBe('growth');
  });
});
