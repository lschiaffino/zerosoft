import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createLabel, createNumber, getChatRow, getNumberRowById, ingestEvents, labelsFor } from '@/lib/groups';
import { groupsViewer, systemViewer } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { connectHubspot, linkHubspot } from '@/lib/groups-hubspot';
import { fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { hubspotEditMode, listGroupsTable, setGroupChats } from '@/lib/groups-table';
import { makeUser } from './helpers';

/**
 * Lines › Grupos, edición en la celda: etiquetas y estado del grupo (PATCH
 * /api/groups/table) y propiedades de la empresa de HubSpot (por el chat que
 * la tiene vinculada, PATCH /api/groups/hubspot/company). Quién puede, en qué
 * chats escribe y qué llega al HubSpot falso. Nombres inventados.
 */

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
const tableRoute = await import('@/app/api/groups/table/route');
const companyRoute = await import('@/app/api/groups/hubspot/company/route');

const TOKEN = 'pat-na1-fake-token-for-table-cells';

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

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

let seq = 0;
const newJid = () => {
  seq += 1;
  return `12036377${String(Date.now()).slice(-6)}${String(seq).padStart(4, '0')}@g.us`;
};

async function groupIn(row: Awaited<ReturnType<typeof line>>, jid: string, name: string) {
  await ingestEvents(row, [
    { type: 'message', chatId: jid, isGroup: true, chatName: name, fromMe: false, senderPhone: '5491100000078', senderName: 'Cliente', providerMessageId: `id-${Math.random().toString(36).slice(2)}`, body: 'Hola' },
  ]);
  const c = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(row.id, jid)) as { id: string } | undefined;
  if (!c) throw new Error(`chat ${name}`);
  return c.id;
}

/** Un grupo en dos líneas abiertas y en una tercera restringida, y una persona (member) que no ve la tercera. */
async function world(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const ventas = await line(owner.id, 'Ventas');
  const soporte = await line(owner.id, 'Soporte');
  const reservada = await line(owner.id, 'Reservada');
  const jid = newJid();
  const name = `Acme ${label}`;
  const a = await groupIn(ventas, jid, name);
  const b = await groupIn(soporte, jid, name);
  const hidden = await groupIn(reservada, jid, name);
  const team = await createTeam(owner.id, 'Workspace');
  const ruth = await makeUser(`${label}-ruth`);
  await addMember(team.id, ruth.id, 'member');
  await setLineAccess(owner.id, reservada.id, { ownerId: owner.id, visibility: 'restricted', personIds: [], teamIds: [] });
  return { owner, ruth, jid, name, a, b, hidden, reservada };
}

const json = (body: unknown) => ({ method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const patchTable = (body: unknown) => tableRoute.PATCH(new Request('http://x/api/groups/table', json(body)));
const patchCompany = (body: unknown) => companyRoute.PATCH(new Request('http://x/api/groups/hubspot/company', json(body)));
const as = (w: Awaited<ReturnType<typeof world>>, role: string, person?: string) => {
  session.user = { id: w.owner.id, email: w.owner.email, role, ...(person ? { actingUser: { id: person } } : {}) };
};

describe('etiquetas y estado en la celda', () => {
  it('van a todos los chats del grupo que quien edita ve; las etiquetas de otro workspace no entran', async () => {
    const w = await world('cells-labels');
    const vip = await createLabel(w.owner.id, { name: 'VIP cells', color: 'green' });
    const other = await makeUser('cells-labels-other');
    const foreign = await createLabel(other.id, { name: 'Ajena', color: 'red' });

    // Ruth (member) no ve la línea reservada: ese chat no se toca aunque venga en el pedido.
    as(w, 'member', w.ruth.id);
    const res = await patchTable({ chatIds: [w.a, w.b, w.hidden], labelIds: [vip.id, foreign.id] });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { chatIds: string[]; labels: Array<{ id: string }> };
    expect(body.chatIds.sort()).toEqual([w.a, w.b].sort());
    expect(body.labels.map((l) => l.id)).toEqual([vip.id]);
    const labels = await labelsFor([w.a, w.b, w.hidden]);
    expect(labels.get(w.a)?.map((l) => l.id)).toEqual([vip.id]);
    expect(labels.get(w.b)?.map((l) => l.id)).toEqual([vip.id]);
    expect(labels.get(w.hidden) ?? []).toEqual([]);

    // Solo la línea que no ve: 404, nada cambia.
    expect((await patchTable({ chatIds: [w.hidden], labelIds: [vip.id] })).status).toBe(404);
    expect((await labelsFor([w.hidden])).get(w.hidden) ?? []).toEqual([]);

    // Estado: cerrar el grupo cierra sus chats visibles; un estado inválido es 400.
    expect((await patchTable({ chatIds: [w.a, w.b, w.hidden], status: 'closed' })).status).toBe(200);
    expect((await getChatRow(w.owner.id, w.a))?.status).toBe('closed');
    expect((await getChatRow(w.owner.id, w.b))?.status).toBe('closed');
    expect((await getChatRow(w.owner.id, w.hidden))?.status).toBe('open');
    expect((await patchTable({ chatIds: [w.a], status: 'archived' })).status).toBe(400);

    // Quitar todas las etiquetas: lista vacía.
    expect((await patchTable({ chatIds: [w.a, w.b], labelIds: [] })).status).toBe(200);
    expect((await labelsFor([w.a])).get(w.a) ?? []).toEqual([]);

    // Un invitado no edita; otro workspace no encuentra los chats.
    as(w, 'guest');
    expect((await patchTable({ chatIds: [w.a], labelIds: [vip.id] })).status).toBe(403);
    session.user = { id: other.id, email: other.email, role: 'owner' };
    expect((await patchTable({ chatIds: [w.a, w.b], status: 'open' })).status).toBe(404);
    expect((await getChatRow(w.owner.id, w.a))?.status).toBe('closed');
  });

  it('sin etiquetas ni estado no hace nada', async () => {
    const w = await world('cells-empty');
    await expect(setGroupChats(w.owner.id, w.owner.id, systemViewer(w.owner.id), [w.a], {})).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('propiedades de HubSpot en la celda', () => {
  it('la fila dice por qué chat se edita (uno que quien mira ve) y si la conexión puede escribir', async () => {
    const w = await world('cells-hs');
    await connectHubspot(w.owner.id, w.owner.id, TOKEN);
    await linkHubspot(w.owner.id, w.owner.id, w.a, 'company', '9001');
    const owner = await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id), { hs: ['plan_tier'] });
    expect(owner.hsEdit).toBe('ok');
    const row = owner.rows.find((r) => r.key === w.jid)!;
    expect(row.company?.id).toBe('9001');
    expect([w.a, w.b, w.hidden]).toContain(row.hsChatId);

    const ruth = await listGroupsTable(w.owner.id, w.ruth.id, await groupsViewer(w.owner.id, w.ruth.id, 'member'), { hs: ['plan_tier'] });
    const seen = ruth.rows.find((r) => r.key === w.jid)!;
    expect([w.a, w.b]).toContain(seen.hsChatId);

    // Sin vínculo no hay chat por donde editar.
    const solo = await groupIn(await line(w.owner.id, 'Sola'), newJid(), 'Globex cells-hs');
    const plain = (await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id))).rows.find((r) => r.chatId === solo)!;
    expect(plain.company).toBeNull();
    expect(plain.hsChatId).toBeNull();
  });

  it('hubspotEditMode: sin conexión, sin permiso de escritura, con teléfonos ocultos', () => {
    const viewer = { mask: false };
    expect(hubspotEditMode(null, false, viewer)).toBe('off');
    expect(hubspotEditMode('["crm.objects.companies.read"]', true, viewer)).toBe('scope');
    expect(hubspotEditMode('not json', true, viewer)).toBe('scope');
    expect(hubspotEditMode('["crm.objects.companies.read","crm.objects.companies.write"]', true, viewer)).toBe('ok');
    expect(hubspotEditMode('["crm.objects.companies.write"]', true, { mask: true })).toBe('mask');
  });

  it('la conexión de solo lectura lo dice en la tabla y el cambio no se escribe', async () => {
    const w = await world('cells-ro');
    await connectHubspot(w.owner.id, w.owner.id, 'pat-na1-readonly-table-cells');
    await linkHubspot(w.owner.id, w.owner.id, w.a, 'company', '9001');
    expect((await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id))).hsEdit).toBe('scope');
    const before = fakeHubspot().companies.get('9001')?.properties.plan_tier;
    as(w, 'owner');
    const res = await patchCompany({ chatId: w.a, property: 'plan_tier', value: 'growth' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/^hubspot_missing_scopes/);
    expect(fakeHubspot().companies.get('9001')?.properties.plan_tier).toBe(before);
  });

  it('el valor llega a HubSpot por el chat vinculado, con el tipo de la propiedad; solo quien ve el chat y puede editarlo', async () => {
    const w = await world('cells-write');
    await connectHubspot(w.owner.id, w.owner.id, TOKEN);
    await linkHubspot(w.owner.id, w.owner.id, w.a, 'company', '9001');
    const row = (await listGroupsTable(w.owner.id, w.ruth.id, await groupsViewer(w.owner.id, w.ruth.id, 'member'), { hs: ['plan_tier'] })).rows.find((r) => r.key === w.jid)!;

    // Ruth (member) edita por el chat que ve: llega al HubSpot falso y a la tabla.
    as(w, 'member', w.ruth.id);
    const ok = await patchCompany({ chatId: row.hsChatId, property: 'plan_tier', value: 'growth' });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(fakeHubspot().companies.get('9001')?.properties.plan_tier).toBe('growth');
    const after = (await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id), { hs: ['plan_tier', 'products_used'] })).rows.find((r) => r.key === w.jid)!;
    expect(after.hs.plan_tier).toBe('growth');

    // Selección múltiple: una lista que llega con ';' (como la guarda HubSpot); una opción que no existe no entra.
    expect((await patchCompany({ chatId: row.hsChatId, property: 'products_used', value: ['inbox', 'analytics'] })).status).toBe(200);
    expect(fakeHubspot().companies.get('9001')?.properties.products_used).toBe('inbox;analytics');
    expect((await patchCompany({ chatId: row.hsChatId, property: 'plan_tier', value: 'platinum' })).status).toBe(400);
    expect((await patchCompany({ chatId: row.hsChatId, property: 'health_score', value: 'mucho' })).status).toBe(400);
    // Calculadas y de solo lectura no se editan.
    expect((await patchCompany({ chatId: row.hsChatId, property: 'seats_per_employee', value: '3' })).status).toBeGreaterThanOrEqual(400);
    expect((await patchCompany({ chatId: row.hsChatId, property: 'hs_object_id', value: '3' })).status).toBeGreaterThanOrEqual(400);
    expect(fakeHubspot().companies.get('9001')?.properties.plan_tier).toBe('growth');

    // Por el chat de la línea que no ve: 404, aunque esté vinculado a la misma empresa.
    expect((await patchCompany({ chatId: w.hidden, property: 'plan_tier', value: 'scale' })).status).toBe(404);
    // Un invitado no edita.
    as(w, 'guest');
    expect((await patchCompany({ chatId: w.a, property: 'plan_tier', value: 'scale' })).status).toBe(403);
    expect(fakeHubspot().companies.get('9001')?.properties.plan_tier).toBe('growth');
  });
});
