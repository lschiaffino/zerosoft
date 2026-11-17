import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { systemViewer, updatePlatformSettings } from '@/lib/groups-access';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { chatHubspot, connectHubspot, disconnectHubspot, getHubspot, linkHubspot } from '@/lib/groups-hubspot';
import { getHubspotSchema } from '@/lib/groups-hubspot-sync';
import { formatHubspotValue } from '@/lib/groups-hubspot-shared';
import { fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { linkContactHubspot, listLinesContacts } from '@/lib/groups-contacts';
import { clearHubspotObjectCache, getHubspotObjectSchema, hubspotDefFromApi } from '@/lib/hubspot-objects';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

/**
 * HubSpot en Lines e Inbox: las propiedades del contacto y del negocio, igual
 * que las de la empresa. El esquema de cada objeto, las que elige cada persona
 * (y el workspace), los valores en los detalles del chat y en el panel,
 * editarlas desde Lines (solo lectura en Inbox) y los permisos que faltan.
 * Todo contra el HubSpot falso en memoria.
 */

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const propsRoute = await import('@/app/api/groups/hubspot/properties/route');
const companyRoute = await import('@/app/api/groups/hubspot/company/route');
const inboxCompanyRoute = await import('@/app/api/inbox/hubspot/company/route');

const TOKEN = 'pat-na1-fake-token-for-object-props';
const DANA = '5491155550142';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetFakeHubspot();
  clearHubspotObjectCache();
});
afterEach(() => {
  session.user = null;
});

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

async function dm(ws: string, phone: string, name: string): Promise<string> {
  const row = await line(ws, `Ventas ${randomUUID().slice(0, 4)}`);
  const chat = `${phone}@s.whatsapp.net`;
  await ingestEvents(row, [{ type: 'message', chatId: chat, isGroup: false, chatName: name, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `p-${randomUUID()}`, body: 'Hola' }]);
  const r = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(row.id, chat)) as { id: string };
  return r.id;
}

async function thread(owner: string, phone: string, title: string) {
  const acc = `iba_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const id = `ibt_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const now = new Date().toISOString();
  await getDb()
    .prepare("INSERT INTO inbox_accounts (id, owner_id, kind, provider, label, address, status, created_at, updated_at) VALUES (?, ?, 'whatsapp', 'fake', 'WA', '5491100000004', 'connected', ?, ?)")
    .run(acc, owner, now, now);
  await getDb()
    .prepare("INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, title, handle, last_message_at, info, created_at, updated_at) VALUES (?, ?, ?, 'whatsapp', 'dm', ?, ?, ?, ?, '', ?, ?)")
    .run(id, owner, acc, `${phone}@s.whatsapp.net`, title, phone, now, now, now);
  return id;
}

const propsUrl = 'http://x/api/groups/hubspot/properties';
const getProps = (type?: string) => propsRoute.GET(new Request(`${propsUrl}${type ? `?type=${type}` : ''}`));
const postProps = (body: unknown) => propsRoute.POST(new Request(propsUrl, { method: 'POST', body: JSON.stringify(body) }));
const getRecord = (chat: string, type: string) => companyRoute.GET(new Request(`http://x/api/groups/hubspot/company?chat=${chat}&type=${type}`));
const patchRecord = (body: unknown) => companyRoute.PATCH(new Request('http://x/api/groups/hubspot/company', { method: 'PATCH', body: JSON.stringify(body) }));
type Dto = { company: { id: string; name: string; broken: unknown } | null; values: Record<string, string>; canEdit: boolean; canWrite: boolean; log: unknown[] };
type Schema = { object: string; props: Array<{ name: string; group: string; kind: string; readOnly: boolean }>; groups: Array<{ name: string }>; pinned: string[]; mine: string[] | null; canWrite: boolean; error: string };

describe('El esquema del contacto y del negocio', () => {
  it('se importa de HubSpot con sus grupos; las ocultas no se ofrecen; trae las de siempre como fijadas', async () => {
    const w = await workspaceWithMember('hs-obj-schema');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, TOKEN);
    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;

    const contact = (await (await getProps('contact')).json()) as Schema;
    expect(contact.object).toBe('contact');
    expect(contact.error).toBe('');
    expect(contact.props.map((p) => p.name)).toEqual(expect.arrayContaining(['jobtitle', 'hs_lead_status', 'preferred_channel', 'hubspot_owner_id']));
    expect(contact.props.some((p) => p.name === 'associatedcompanyid')).toBe(false);
    expect(contact.props.find((p) => p.name === 'hubspot_owner_id')?.kind).toBe('owner');
    expect(contact.props.find((p) => p.name === 'createdate')?.readOnly).toBe(true);
    expect(contact.groups.map((g) => g.name)).toEqual(['contactinformation', 'sales_properties', 'contact_activity']);
    expect(contact.pinned).toEqual(['email', 'jobtitle', 'lifecyclestage', 'hubspot_owner_id']);
    expect(contact.canWrite).toBe(true);

    const deal = (await (await getProps('deal')).json()) as Schema;
    expect(deal.pinned).toEqual(['dealstage', 'amount', 'closedate', 'hubspot_owner_id']);
    expect(deal.props.find((p) => p.name === 'hs_deal_stage_probability')?.readOnly).toBe(true);
    // Sin `type`, la empresa (como antes); otro valor es un error.
    expect(((await (await getProps()).json()) as Schema).props.some((p) => p.name === 'plan_tier')).toBe(true);
    expect((await getProps('ticket')).status).toBe(400);

    // Se importa una vez: la segunda lectura sale de la copia.
    const reads = () => fakeHubspot().calls.filter((c) => c.path === '/crm/v3/properties/contacts').length;
    const before = reads();
    await getHubspotObjectSchema(ws, 'contact', w.member.id);
    expect(reads()).toBe(before);

    session.user = asMember(w.owner, w.friend, 'guest') as unknown as Record<string, unknown>;
    expect((await getProps('contact')).status).toBe(403);
  });

  it('sin permiso para leer el esquema queda el error con el permiso que falta, sin marcar la conexión', async () => {
    const w = await workspaceWithMember('hs-obj-noscope');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, 'pat-noobjschema-token');
    const schema = await getHubspotObjectSchema(ws, 'contact', ws);
    expect(schema.props).toEqual([]);
    expect(schema.error).toBe('hubspot_missing_scopes:crm.schemas.contacts.read');
    expect((await getHubspotObjectSchema(ws, 'deal', ws)).error).toBe('hubspot_missing_scopes:crm.schemas.deals.read');
    expect((await getHubspot(ws)).lastError).toBe('');
    // La empresa sigue igual.
    expect((await getHubspotSchema(ws)).props.length).toBeGreaterThan(0);
  });

  it('una propiedad de HubSpot que no sirve no entra', () => {
    expect(hubspotDefFromApi({ name: 'bad name!', label: 'x' })).toBeNull();
    expect(hubspotDefFromApi({ name: 'gone', archived: true })).toBeNull();
    expect(hubspotDefFromApi({ name: 'score', type: 'number', fieldType: 'calculation_equation', groupName: 'g' })).toMatchObject({ kind: 'number', calculated: true, readOnly: true, custom: true });
  });
});

describe('Las del contacto y del negocio que ve cada persona', () => {
  it('cada objeto tiene su lista; la empresa no cambia; el workspace (admins) elige las de todos', async () => {
    const w = await workspaceWithMember('hs-obj-mine');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, TOKEN);
    const chat = await dm(ws, DANA, 'Dana');
    await linkHubspot(ws, ws, chat, 'contact', '7001');
    await linkHubspot(ws, ws, chat, 'deal', '8001');

    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    expect((await postProps({ type: 'contact', pinned: ['city'] })).status).toBe(403);
    expect((await postProps({ type: 'nope', mine: [] })).status).toBe(400);
    const saved = (await (await postProps({ type: 'contact', mine: ['hs_lead_status', 'nope', 'associatedcompanyid', 'jobtitle', 'hs_lead_status'] })).json()) as Schema;
    expect(saved.object).toBe('contact');
    expect(saved.mine).toEqual(['hs_lead_status', 'jobtitle']);
    expect(((await (await getProps()).json()) as Schema).mine).toBeNull();
    expect(((await (await getProps('deal')).json()) as Schema).mine).toBeNull();

    // Los detalles del chat: las suyas a esa persona, las del workspace al resto.
    const mineDto = await chatHubspot(ws, chat, w.member.id);
    expect(mineDto.objects?.contact?.pinned.map((p) => p.name)).toEqual(['hs_lead_status', 'jobtitle']);
    expect(mineDto.objects?.contact?.pinned[0]).toMatchObject({ value: 'CONNECTED', options: [{ label: 'Connected', value: 'CONNECTED' }] });
    const other = await chatHubspot(ws, chat, w.friend.id);
    expect(other.objects?.contact?.pinned.map((p) => p.name)).toEqual(['email', 'jobtitle', 'lifecyclestage', 'hubspot_owner_id']);
    expect(other.objects?.contact?.pinned.find((p) => p.name === 'hubspot_owner_id')?.ownerName).toBe('Paula Ortiz');
    expect(other.objects?.deal?.pinned.map((p) => p.name)).toEqual(['dealstage', 'amount', 'closedate', 'hubspot_owner_id']);
    // El monto va con la moneda del negocio; la fecha de cierre (medianoche UTC) es un día.
    expect(other.objects?.deal?.currency).toBe('USD');
    const amount = other.objects?.deal?.pinned.find((p) => p.name === 'amount');
    const f = { locale: 'en', owners: [], yes: 'Yes', no: 'No', currency: other.objects?.deal?.currency };
    expect(formatHubspotValue(amount, amount?.value ?? '', f)).toContain('$12,000');
    const close = other.objects?.deal?.pinned.find((p) => p.name === 'closedate');
    expect(formatHubspotValue(close, close?.value ?? '', f)).toBe('Dec 15, 2026');
    expect(formatHubspotValue({ name: 'contract_months', kind: 'number', options: [] }, '12', f)).toBe('12');

    // Un admin elige las del negocio para todo el workspace.
    session.user = asOwner(w.owner) as unknown as Record<string, unknown>;
    const ws2 = (await (await postProps({ type: 'deal', pinned: ['dealtype', 'contract_months', 'nope'] })).json()) as Schema;
    expect(ws2.pinned).toEqual(['dealtype', 'contract_months']);
    expect((await chatHubspot(ws, chat, w.friend.id)).objects?.deal?.pinned.map((p) => p.name)).toEqual(['dealtype', 'contract_months']);
    // null vuelve a las del workspace.
    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    expect(((await (await postProps({ type: 'contact', mine: null })).json()) as Schema).mine).toBeNull();

    session.user = asMember(w.owner, w.friend, 'guest') as unknown as Record<string, unknown>;
    expect((await postProps({ type: 'contact', mine: ['city'] })).status).toBe(403);
  });

  it('quien tiene los teléfonos ocultos no ve el email ni los teléfonos del contacto', async () => {
    const w = await workspaceWithMember('hs-obj-mask');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, TOKEN);
    const chat = await dm(ws, DANA, 'Dana');
    await linkHubspot(ws, ws, chat, 'contact', '7001');
    await updatePlatformSettings(ws, { maskRoles: ['member'] });
    const dto = await chatHubspot(ws, chat, w.member.id, true);
    expect(dto.objects?.contact?.pinned.find((p) => p.name === 'email')?.value).toBe('•••');
    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    const rec = (await (await getRecord(chat, 'contact')).json()) as Dto;
    expect(rec.values.email).toBe('•••');
    expect(rec.values.phone).toBe('•••');
    expect(rec.values.jobtitle).toBe('Operations lead');
    expect(rec.canEdit).toBe(false);
    expect((await patchRecord({ chatId: chat, type: 'contact', property: 'jobtitle', value: 'x' })).status).toBe(403);
  });
});

describe('Lines: el contacto y el negocio en el panel de HubSpot', () => {
  it('trae todos los valores, edita en HubSpot en el momento y dice por qué no guardó', async () => {
    const w = await workspaceWithMember('hs-obj-edit');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, TOKEN);
    const chat = await dm(ws, DANA, 'Dana');
    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    // Sin vínculo: sin registro (y editar no tiene a quién).
    expect(((await (await getRecord(chat, 'deal')).json()) as Dto).company).toBeNull();
    expect((await patchRecord({ chatId: chat, type: 'deal', property: 'amount', value: '1' })).status).toBe(409);
    await linkHubspot(ws, ws, chat, 'contact', '7001');
    await linkHubspot(ws, ws, chat, 'deal', '8001');

    const contact = (await (await getRecord(chat, 'contact')).json()) as Dto;
    expect(contact.company).toMatchObject({ id: '7001', name: 'Dana Rivers', broken: null });
    expect(contact.values).toMatchObject({ jobtitle: 'Operations lead', preferred_channel: 'whatsapp', lifecyclestage: 'customer' });
    expect(contact.canEdit).toBe(true);
    expect(contact.log).toEqual([]);
    const deal = (await (await getRecord(chat, 'deal')).json()) as Dto;
    expect(deal.company).toMatchObject({ id: '8001', name: 'Acme Logistics renewal' });
    expect(deal.values).toMatchObject({ dealstage: 'contractsent', amount: '12000', contract_months: '12' });

    const ok = await patchRecord({ chatId: chat, type: 'contact', property: 'hs_lead_status', value: 'OPEN' });
    expect(ok.status).toBe(200);
    expect(fakeHubspot().contacts.get('7001')?.properties.hs_lead_status).toBe('OPEN');
    // Lo que se lee después ya trae el valor nuevo (la copia en memoria se actualiza).
    expect(((await (await getRecord(chat, 'contact')).json()) as Dto).values.hs_lead_status).toBe('OPEN');
    expect((await patchRecord({ chatId: chat, type: 'deal', property: 'amount', value: '15000.5' })).status).toBe(200);
    expect(fakeHubspot().deals.get('8001')?.properties.amount).toBe('15000.5');

    // Lo que no corresponde al tipo, de solo lectura u oculto no llega a HubSpot.
    const calls = fakeHubspot().calls.length;
    expect((await patchRecord({ chatId: chat, type: 'deal', property: 'amount', value: 'mucho' })).status).toBe(400);
    expect((await patchRecord({ chatId: chat, type: 'deal', property: 'dealstage', value: 'nope' })).status).toBe(400);
    expect((await patchRecord({ chatId: chat, type: 'deal', property: 'hs_deal_stage_probability', value: '1' })).status).toBe(400);
    expect((await patchRecord({ chatId: chat, type: 'contact', property: 'associatedcompanyid', value: '1' })).status).toBe(400);
    expect(fakeHubspot().calls.filter((c, i) => i >= calls && c.method === 'PATCH')).toHaveLength(0);

    // "Sincronizar ahora" vuelve a leer de HubSpot aunque haya copia.
    fakeHubspot().deals.get('8001')!.properties.next_step = 'Send the contract';
    const synced = await companyRoute.POST(new Request('http://x/api/groups/hubspot/company', { method: 'POST', body: JSON.stringify({ chatId: chat, type: 'deal' }) }));
    expect(((await synced.json()) as Dto).values.next_step).toBe('Send the contract');

    // Borrado en HubSpot: el panel lo dice.
    fakeHubspot().deals.delete('8001');
    clearHubspotObjectCache();
    expect(((await (await getRecord(chat, 'deal')).json()) as Dto).company?.broken).toMatchObject({ reason: 'deleted' });
    expect((await patchRecord({ chatId: chat, type: 'deal', property: 'amount', value: '1' })).status).toBe(409);

    // Otra persona fuera del workspace no ve el chat.
    session.user = asOwner(w.stranger) as unknown as Record<string, unknown>;
    expect((await getRecord(chat, 'contact')).status).toBe(404);
  });

  it('sin permiso de escritura se lee pero no se edita', async () => {
    const w = await workspaceWithMember('hs-obj-ro');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, 'pat-readonly-objects');
    const chat = await dm(ws, DANA, 'Dana');
    await linkHubspot(ws, ws, chat, 'contact', '7001');
    session.user = asOwner(w.owner) as unknown as Record<string, unknown>;
    const dto = (await (await getRecord(chat, 'contact')).json()) as Dto;
    expect(dto.canWrite).toBe(false);
    expect(dto.canEdit).toBe(false);
    const res = await patchRecord({ chatId: chat, type: 'contact', property: 'jobtitle', value: 'x' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('hubspot_missing_scopes:crm.objects.contacts.write');
  });

  it('desconectar borra el esquema importado (otra cuenta lo vuelve a importar)', async () => {
    const owner = (await workspaceWithMember('hs-obj-disc')).owner;
    await connectHubspot(owner.id, owner.id, TOKEN);
    await getHubspotObjectSchema(owner.id, 'contact', owner.id);
    await disconnectHubspot(owner.id);
    expect(await getDb().prepare('SELECT 1 FROM hubspot_object_schema WHERE ws = ?').get(owner.id)).toBeUndefined();
    expect((await getHubspotObjectSchema(owner.id, 'contact', owner.id)).connected).toBe(false);
  });
});

describe('Inbox: el contacto y su negocio en el panel de HubSpot', () => {
  it('el contacto vinculado y el negocio que HubSpot le asocia, solo lectura; sin contacto nada; otra persona 404', async () => {
    const w = await workspaceWithMember('hs-obj-inbox');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, TOKEN);
    await dm(ws, DANA, 'Dana');
    const t = await thread(w.member.id, DANA, 'Dana');
    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    const get = (type: string) => inboxCompanyRoute.GET(new Request(`http://x/api/inbox/hubspot/company?thread=${t}&type=${type}`));
    expect(((await (await get('contact')).json()) as Dto).company).toBeNull();
    expect(((await (await get('deal')).json()) as Dto).company).toBeNull();
    expect((await get('ticket')).status).toBe(400);

    const dana = (await listLinesContacts(systemViewer(ws))).rows.find((r) => r.phone === DANA)!;
    await linkContactHubspot(systemViewer(ws), ws, dana.id, '7001');
    const contact = (await (await get('contact')).json()) as Dto;
    expect(contact.company).toMatchObject({ id: '7001' });
    expect(contact.values.jobtitle).toBe('Operations lead');
    expect(contact.canEdit).toBe(false);
    const deal = (await (await get('deal')).json()) as Dto;
    expect(deal.company).toMatchObject({ id: '8001', name: 'Acme Logistics renewal' });
    expect(deal.values.dealstage).toBe('contractsent');
    const sync = await inboxCompanyRoute.POST(new Request('http://x/api/inbox/hubspot/company', { method: 'POST', body: JSON.stringify({ threadId: t, type: 'deal' }) }));
    expect(sync.status).toBe(200);

    session.user = asOwner(w.stranger) as unknown as Record<string, unknown>;
    expect((await get('contact')).status).toBe(404);
    session.user = asMember(w.owner, w.friend, 'guest') as unknown as Record<string, unknown>;
    expect((await get('deal')).status).toBe(403);
  });
});
