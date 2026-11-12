import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { groupsViewer, systemViewer, updatePlatformSettings } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { chatHubspot, connectHubspot, linkHubspot, unlinkHubspot } from '@/lib/groups-hubspot';
import { resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { mergeGroupChats, type IdentityChat } from '@/lib/groups-identity';
import { cleanHsColumns, listGroupsTable } from '@/lib/groups-table';
import { groupIdentityUp } from '@/lib/schema/group-identity-migration';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
const tableRoute = await import('@/app/api/groups/table/route');

const TOKEN = 'pat-na1-fake-token-for-identity-tests';

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

// ---------------------------------------------------------------------
// Puro
// ---------------------------------------------------------------------

const chat = (over: Partial<IdentityChat> & Pick<IdentityChat, 'id'>): IdentityChat => ({
  jid: '120363000000000001@g.us',
  numberId: 'n1',
  matched: true,
  name: 'Acme soporte',
  memberCount: 3,
  status: 'open',
  leftAt: null,
  flagged: false,
  archived: false,
  labels: [],
  properties: {},
  lastMessageAt: '2026-11-01T10:00:00.000Z',
  createdAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

describe('mergeGroupChats', () => {
  it('el mismo JID en dos líneas es una fila con las dos líneas; el principal es el más activo de los que cumplen', () => {
    const rows = mergeGroupChats([
      chat({ id: 'a', numberId: 'n1', memberCount: 3, lastMessageAt: '2026-11-01T10:00:00.000Z', labels: [{ id: 'l2', name: 'VIP', color: 'red' }] }),
      chat({ id: 'b', numberId: 'n2', memberCount: 5, lastMessageAt: '2026-11-02T10:00:00.000Z', labels: [{ id: 'l1', name: 'Clientes', color: 'blue' }] }),
      chat({ id: 'c', jid: '120363000000000002@g.us', numberId: 'n1', name: 'Globex' }),
    ]);
    expect(rows).toHaveLength(2);
    const acme = rows.find((r) => r.key === '120363000000000001@g.us')!;
    expect(acme.chatId).toBe('b');
    expect(acme.chatIds).toEqual(['b', 'a']);
    expect(acme.lines).toEqual([
      { numberId: 'n2', chatId: 'b' },
      { numberId: 'n1', chatId: 'a' },
    ]);
    expect(acme.memberCount).toBe(5);
    expect(acme.labels.map((l) => l.name)).toEqual(['Clientes', 'VIP']);
    expect(acme.lastActivity).toBe('2026-11-02T10:00:00.000Z');
    // Más reciente primero.
    expect(rows[0].key).toBe('120363000000000001@g.us');
  });

  it('un grupo entra solo si alguno de sus chats cumple los filtros; los otros suman sus líneas', () => {
    const rows = mergeGroupChats([
      chat({ id: 'a', numberId: 'n1', matched: false, lastMessageAt: '2026-11-05T00:00:00.000Z' }),
      chat({ id: 'b', numberId: 'n2', matched: true, lastMessageAt: '2026-11-01T00:00:00.000Z' }),
      chat({ id: 'x', jid: '120363000000000009@g.us', matched: false }),
    ]);
    expect(rows).toHaveLength(1);
    // El que se abre es el que cumple, aunque el otro tenga actividad más nueva.
    expect(rows[0].chatId).toBe('b');
    expect(rows[0].lines.map((l) => l.numberId)).toEqual(['n2', 'n1']);
  });

  it('propiedades: la del principal y, si no tiene, la del más activo; salió solo si salieron todas las líneas', () => {
    const [row] = mergeGroupChats([
      chat({ id: 'a', numberId: 'n1', properties: { plan: 'Gold', region: '' }, leftAt: '2026-11-03T00:00:00.000Z', lastMessageAt: '2026-11-03T00:00:00.000Z' }),
      chat({ id: 'b', numberId: 'n2', properties: { plan: 'Silver', region: 'Norte', tier: 2 }, lastMessageAt: '2026-11-01T00:00:00.000Z', status: 'closed' }),
    ]);
    expect(row.properties).toEqual({ plan: 'Gold', region: 'Norte', tier: 2 });
    expect(row.leftAt).toBeNull();
    expect(row.status).toBe('open');
    const [left] = mergeGroupChats([
      chat({ id: 'a', leftAt: '2026-11-03T00:00:00.000Z' }),
      chat({ id: 'b', numberId: 'n2', leftAt: '2026-11-04T00:00:00.000Z' }),
    ]);
    expect(left.leftAt).not.toBeNull();
  });

  it('sin JID cada chat queda solo; un chat repetido cuenta una vez; dos chats en la misma línea dan una línea', () => {
    const rows = mergeGroupChats([chat({ id: 'a', jid: '' }), chat({ id: 'b', jid: '' }), chat({ id: 'b', jid: '' })]);
    expect(rows.map((r) => r.key).sort()).toEqual(['chat:a', 'chat:b']);
    const [one] = mergeGroupChats([chat({ id: 'a', numberId: 'n1' }), chat({ id: 'b', numberId: 'n1', lastMessageAt: '2026-10-01T00:00:00.000Z' })]);
    expect(one.lines).toEqual([{ numberId: 'n1', chatId: 'a' }]);
    expect(one.chatIds).toEqual(['a', 'b']);
  });

  it('columnas de HubSpot: nombres válidos, sin repetir y con tope', () => {
    expect(cleanHsColumns('name,domain,name,bad name,;drop')).toEqual(['name', 'domain']);
    expect(cleanHsColumns(Array.from({ length: 80 }, (_, i) => `p${i}`))).toHaveLength(40);
  });
});

// ---------------------------------------------------------------------
// Con base
// ---------------------------------------------------------------------

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
  return `12036399${String(Date.now()).slice(-6)}${String(seq).padStart(4, '0')}@g.us`;
};

/** El grupo `jid` recibe un mensaje en esa línea; devuelve su chat en esa línea. */
async function groupIn(ws: string, row: Awaited<ReturnType<typeof line>>, jid: string, name: string) {
  await ingestEvents(row, [
    { type: 'message', chatId: jid, isGroup: true, chatName: name, fromMe: false, senderPhone: '5491100000077', senderName: 'Cliente', providerMessageId: `id-${Math.random().toString(36).slice(2)}`, body: 'Hola' },
  ]);
  const c = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(row.id, jid)) as { id: string } | undefined;
  if (!c) throw new Error(`chat ${name}`);
  return c.id;
}

const companyLink = async (ws: string, chatId: string) => (await chatHubspot(ws, chatId)).links.find((l) => l.type === 'company')?.id ?? null;

async function world(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const ventas = await line(owner.id, 'Ventas');
  const soporte = await line(owner.id, 'Soporte');
  const jid = newJid();
  const name = `Acme ${label}`;
  const a = await groupIn(owner.id, ventas, jid, name);
  const b = await groupIn(owner.id, soporte, jid, name);
  return { owner, ventas, soporte, jid, name, a, b };
}

describe('tabla de grupos: un grupo en varias líneas', () => {
  it('el mismo grupo en dos líneas es una fila con las dos; filtrar por una línea lo sigue mostrando con las dos', async () => {
    const w = await world('merge');
    const solo = await groupIn(w.owner.id, w.ventas, newJid(), `Globex merge`);
    const all = await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id));
    const acme = all.rows.filter((r) => r.name === w.name);
    expect(acme).toHaveLength(1);
    expect(acme[0].key).toBe(w.jid);
    expect(acme[0].lines.map((l) => l.numberId).sort()).toEqual([w.ventas.id, w.soporte.id].sort());
    expect(acme[0].lines.map((l) => l.chatId).sort()).toEqual([w.a, w.b].sort());
    expect(all.rows.find((r) => r.chatId === solo)?.lines).toEqual([{ numberId: w.ventas.id, chatId: solo }]);
    // Solo la línea Soporte: el grupo de Acme está (con sus dos líneas) y el de Globex no.
    const one = await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id), { filters: { lines: [w.soporte.id] } });
    expect(one.rows.map((r) => r.name)).toEqual([w.name]);
    expect(one.rows[0].chatId).toBe(w.b);
    expect(one.rows[0].lines).toHaveLength(2);
    // Varias líneas: lo mismo que todas.
    const both = await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id), { filters: { lines: [w.soporte.id, w.ventas.id] } });
    expect(both.rows.map((r) => r.name).sort()).toEqual([w.name, 'Globex merge'].sort());
    // Los 1 a 1 no entran.
    expect(all.rows.every((r) => r.key.endsWith('@g.us'))).toBe(true);
  });

  it('quien no ve una línea no ve sus grupos ni la cuenta entre las líneas de un grupo', async () => {
    const w = await world('access');
    const reservada = await line(w.owner.id, 'Reservada');
    const hiddenOnly = await groupIn(w.owner.id, reservada, newJid(), 'Secreto access');
    await groupIn(w.owner.id, reservada, w.jid, w.name);
    const team = await createTeam(w.owner.id, 'Workspace');
    const ruth = await makeUser('identity-ruth');
    await addMember(team.id, ruth.id, 'member');
    await setLineAccess(w.owner.id, reservada.id, { ownerId: w.owner.id, visibility: 'restricted', personIds: [], teamIds: [] });
    const viewer = await groupsViewer(w.owner.id, ruth.id, 'member');
    const seen = await listGroupsTable(w.owner.id, ruth.id, viewer);
    expect(seen.rows.some((r) => r.chatId === hiddenOnly || r.name === 'Secreto access')).toBe(false);
    const acme = seen.rows.find((r) => r.name === w.name)!;
    expect(acme.lines.map((l) => l.numberId).sort()).toEqual([w.ventas.id, w.soporte.id].sort());
    // Pedir la línea reservada por filtro no la abre.
    expect((await listGroupsTable(w.owner.id, ruth.id, viewer, { filters: { lines: [reservada.id] } })).rows).toEqual([]);
    // Con acceso por etiqueta y sin etiquetas, no ve ninguno.
    await updatePlatformSettings(w.owner.id, { labelAccess: true });
    expect((await listGroupsTable(w.owner.id, ruth.id, await groupsViewer(w.owner.id, ruth.id, 'member'))).rows).toEqual([]);
    await updatePlatformSettings(w.owner.id, { labelAccess: false });
    // El dueño ve las tres líneas.
    const owner = await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id));
    expect(owner.rows.find((r) => r.name === w.name)?.lines).toHaveLength(3);
  });
});

describe('empresa de HubSpot única por grupo', () => {
  it('vincular desde una línea la pone en todas; cambiarla desde otra la cambia en todas; quitarla la quita de todas', async () => {
    const w = await world('unique');
    await connectHubspot(w.owner.id, w.owner.id, TOKEN);
    await linkHubspot(w.owner.id, w.owner.id, w.a, 'company', '9001');
    expect(await companyLink(w.owner.id, w.a)).toBe('9001');
    expect(await companyLink(w.owner.id, w.b)).toBe('9001');
    const ident = () => getDb().prepare('SELECT company_id FROM groups_identities WHERE user_id = ? AND jid = ?').get(w.owner.id, w.jid) as Promise<{ company_id: string }>;
    expect((await ident()).company_id).toBe('9001');

    await linkHubspot(w.owner.id, w.owner.id, w.b, 'company', '9002');
    expect(await companyLink(w.owner.id, w.a)).toBe('9002');
    expect(await companyLink(w.owner.id, w.b)).toBe('9002');
    expect((await ident()).company_id).toBe('9002');
    // Una sola fila de vínculo por chat (nunca dos empresas).
    const n = (await getDb()
      .prepare("SELECT COUNT(*) AS n FROM groups_hubspot_links WHERE user_id = ? AND object_type = 'company' AND chat_id IN (?, ?)")
      .get(w.owner.id, w.a, w.b)) as { n: number };
    expect(Number(n.n)).toBe(2);

    const table = await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id), { hs: ['plan_tier', 'domain', 'phone'] });
    const row = table.rows.find((r) => r.key === w.jid)!;
    expect(row.company).toMatchObject({ id: '9002', name: 'Globex Retail', broken: false });
    expect(row.company?.url).toMatch(/^https:\/\/app[a-z0-9-]*\.hubspot\.com\/contacts\/\d+\/record\/0-2\/9002$/);
    expect(row.hs).toMatchObject({ plan_tier: 'starter', domain: 'globex-retail.example' });

    expect(await unlinkHubspot(w.owner.id, w.a, 'company')).toBe(true);
    expect(await companyLink(w.owner.id, w.a)).toBeNull();
    expect(await companyLink(w.owner.id, w.b)).toBeNull();
    expect((await ident()).company_id).toBe('');
    expect((await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id))).rows.find((r) => r.key === w.jid)?.company).toBeNull();
    // Quitar otra vez: no había nada.
    expect(await unlinkHubspot(w.owner.id, w.b, 'company')).toBe(false);
  });

  it('una línea que entra después a un grupo vinculado hereda la empresa', async () => {
    const w = await world('inherit');
    await connectHubspot(w.owner.id, w.owner.id, TOKEN);
    await linkHubspot(w.owner.id, w.owner.id, w.a, 'company', '9001');
    const tercera = await line(w.owner.id, 'Tercera');
    const c = await groupIn(w.owner.id, tercera, w.jid, w.name);
    expect(await companyLink(w.owner.id, c)).toBe('9001');
    // Y el filtro "vinculados a HubSpot" de la bandeja la encuentra.
    const linked = await listChats(w.owner.id, w.owner.id, { hubspot: 'linked', numberId: tercera.id, viewer: systemViewer(w.owner.id) });
    expect(linked.rows.map((r) => r.id)).toEqual([c]);
  });

  it('teléfonos ocultos: la tabla tampoco muestra los de la empresa', async () => {
    const w = await world('mask');
    await connectHubspot(w.owner.id, w.owner.id, TOKEN);
    await linkHubspot(w.owner.id, w.owner.id, w.a, 'company', '9001');
    const guest = await makeUser('identity-guest');
    const team = await createTeam(w.owner.id, 'Workspace');
    await addMember(team.id, guest.id, 'guest');
    await updatePlatformSettings(w.owner.id, { labelAccess: false });
    const ownerRow = (await listGroupsTable(w.owner.id, w.owner.id, systemViewer(w.owner.id), { hs: ['phone', 'city'] })).rows.find((r) => r.key === w.jid)!;
    expect(ownerRow.hs).toMatchObject({ phone: '+54 341 555 0100', city: 'Rosario' });
    const masked = { ...systemViewer(w.owner.id), me: guest.id, role: 'member' as const, mask: true };
    const row = (await listGroupsTable(w.owner.id, guest.id, masked, { hs: ['phone', 'city'] })).rows.find((r) => r.key === w.jid)!;
    expect(row.hs).toEqual({ phone: '•••', city: 'Rosario' });
  });

  it('otro workspace con el mismo grupo tiene su propia identidad y no ve la empresa del primero', async () => {
    const w = await world('ws-a');
    await connectHubspot(w.owner.id, w.owner.id, TOKEN);
    await linkHubspot(w.owner.id, w.owner.id, w.a, 'company', '9001');
    const other = await makeUser('identity-other-ws');
    const otherLine = await line(other.id, 'Ajena');
    const theirs = await groupIn(other.id, otherLine, w.jid, w.name);
    expect(await companyLink(other.id, theirs)).toBeNull();
    const table = await listGroupsTable(other.id, other.id, systemViewer(other.id), { hs: ['plan_tier'] });
    const row = table.rows.find((r) => r.key === w.jid)!;
    expect(row.company).toBeNull();
    expect(row.hs).toEqual({});
    expect(row.lines).toEqual([{ numberId: otherLine.id, chatId: theirs }]);
    expect(table.hubspot).toBe(false);
    // La ruta, como la otra persona, tampoco los mezcla.
    session.user = { id: other.id, email: other.email, role: 'owner' };
    const res = await tableRoute.GET(new Request(`http://x/api/groups/table?hs=plan_tier&f=${encodeURIComponent(JSON.stringify({ lines: [w.ventas.id] }))}`));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rows: unknown[] }).rows).toEqual([]);
  });

  it('la migración junta empresas distintas por línea: gana la vinculada más recientemente', async () => {
    const w = await world('migrate');
    await connectHubspot(w.owner.id, w.owner.id, TOKEN);
    const db = getDb();
    // Como antes de la identidad: cada línea con su empresa.
    await db.prepare('DELETE FROM groups_identities WHERE user_id = ?').run(w.owner.id);
    await db
      .prepare(
        "INSERT INTO groups_hubspot_links (chat_id, user_id, object_type, object_id, name, props, missing, created_at) VALUES (?, ?, 'company', '9001', 'Acme Logistics', '{}', 0, '2026-01-01T00:00:00.000Z'), (?, ?, 'company', '9003', 'Initech Foods', '{}', 0, '2026-02-01T00:00:00.000Z')",
      )
      .run(w.a, w.owner.id, w.b, w.owner.id);
    // Dos veces: la segunda no cambia nada.
    await groupIdentityUp(getClient());
    await groupIdentityUp(getClient());
    expect(await companyLink(w.owner.id, w.a)).toBe('9003');
    expect(await companyLink(w.owner.id, w.b)).toBe('9003');
  });
});
