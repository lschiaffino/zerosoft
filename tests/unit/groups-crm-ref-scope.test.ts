/**
 * Lines: el contacto y la empresa del CRM vinculados a un chat salen solo si
 * quien mira los ve en el CRM. En la lista, la info del chat, la API v1 y la
 * timeline de un registro, uno que no ve sale en null (ni su id). Vincular un
 * grupo nuevo a una empresa que no ve no la vincula. Miradas: anónimo, otro
 * workspace, miembro con visibilidad "mine", invitado, owner y admin. Datos
 * inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompany, createContact } from '@/lib/crm';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { chatsForCrmRecord, connectNumber, createNumber, upsertChat } from '@/lib/groups';
import { scopeChatCrmRefs, systemViewer, type GroupsViewer } from '@/lib/groups-access';
import { createApiKey } from '@/lib/api-auth';
import { addMember } from '@/lib/teams';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const chatsRoute = await import('@/app/api/groups/chats/route');
const chatRoute = await import('@/lib/routes/groups/chats/[id]/route');
const createRoute = await import('@/app/api/groups/create/route');
const v1ChatsRoute = await import('@/app/api/v1/groups/chats/route');
const v1ChatRoute = await import('@/lib/routes/v1/groups/chats/[id]/route');
const auditRoute = await import('@/app/api/groups/audit/route');

beforeEach(() => {
  session.user = null;
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json', ...headers },
  });

type ChatOut = { id: string; crmContactId: string | null; crmCompanyId: string | null };

/** Owner con un contacto y una empresa suyos (el miembro no los ve, "mine") y un contacto del miembro. */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const adminPerson = await makeUser(`${label}-admin`);
  await addMember(w.team.id, adminPerson.id, 'admin');
  await setMemberVisibility(ws, 'mine');
  const hiddenContact = await createContact(ws, { firstName: 'Hidden', email: `hidden-${label}@client.test`, ownerId: ws });
  const hiddenCompany = await createCompany(ws, { name: 'Hidden Co', domain: `hidden-${label}.test`, ownerId: ws });
  const ownContact = await createContact(ws, { firstName: 'Own', email: `own-${label}@client.test`, ownerId: w.member.id });
  const n = await createNumber(ws, ws, { provider: 'fake' });
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const linked = await upsertChat({ id: n.id, user_id: ws }, { providerChatId: `12036301${stamp}@g.us`, kind: 'group', name: 'Linked' }, { silent: true });
  const mine = await upsertChat({ id: n.id, user_id: ws }, { providerChatId: `12036302${stamp}@g.us`, kind: 'group', name: 'Mine' }, { silent: true });
  await getDb().prepare('UPDATE groups_chats SET crm_contact_id = ?, crm_company_id = ? WHERE id = ?').run(hiddenContact.id, hiddenCompany.id, linked.id);
  await getDb().prepare('UPDATE groups_chats SET crm_contact_id = ? WHERE id = ?').run(ownContact.id, mine.id);
  return { w, ws, adminPerson, hiddenContact, hiddenCompany, ownContact, n, linked, mine };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.adminPerson, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);

async function listAs(user: SessionUser | null): Promise<{ status: number; rows: ChatOut[] }> {
  session.user = user;
  const res = await chatsRoute.GET(req('GET', '/api/groups/chats?filter=all&meta=0') as never);
  if (res.status !== 200) return { status: res.status, rows: [] };
  return { status: 200, rows: ((await res.json()) as { rows: ChatOut[] }).rows };
}

describe('Lines: vínculos al CRM según lo que quien mira ve en el CRM', () => {
  it('anónimo no lista; otro workspace no ve los chats', async () => {
    const s = await setup('lcrm-anon');
    expect((await listAs(null)).status).toBe(401);
    const other = await listAs(asOwner(s.w.stranger));
    expect(other.rows.map((r) => r.id)).not.toContain(s.linked.id);
    session.user = asOwner(s.w.stranger);
    expect((await chatRoute.GET(req('GET', `/api/groups/chats/${s.linked.id}`), ctx(s.linked.id))).status).toBe(404);
  });

  it('owner y admin ven los vínculos', async () => {
    const s = await setup('lcrm-own');
    for (const u of [owner(s), admin(s)]) {
      const row = (await listAs(u)).rows.find((r) => r.id === s.linked.id);
      expect(row).toMatchObject({ crmContactId: s.hiddenContact.id, crmCompanyId: s.hiddenCompany.id });
    }
  });

  it('un miembro no recibe el id de un contacto o empresa que no ve; sí el de uno suyo', async () => {
    const s = await setup('lcrm-mem');
    const { rows } = await listAs(member(s));
    expect(rows.find((r) => r.id === s.linked.id)).toMatchObject({ crmContactId: null, crmCompanyId: null });
    expect(rows.find((r) => r.id === s.mine.id)).toMatchObject({ crmContactId: s.ownContact.id });
    const body = JSON.stringify(rows);
    expect(body).not.toContain(s.hiddenContact.id);
    expect(body).not.toContain(s.hiddenCompany.id);
    // La info del chat y lo que devuelve un cambio, igual.
    session.user = member(s);
    const one = (await (await chatRoute.GET(req('GET', `/api/groups/chats/${s.linked.id}`), ctx(s.linked.id))).json()) as { chat: ChatOut };
    expect(one.chat).toMatchObject({ crmContactId: null, crmCompanyId: null });
    const patched = await chatRoute.PATCH(req('PATCH', `/api/groups/chats/${s.linked.id}`, { pinned: true }), ctx(s.linked.id));
    expect(patched.status).toBe(200);
    expect(JSON.stringify(await patched.json())).not.toContain(s.hiddenCompany.id);
    // El vínculo guardado no cambia.
    const stored = (await getDb().prepare('SELECT crm_contact_id, crm_company_id FROM groups_chats WHERE id = ?').get(s.linked.id)) as Record<string, string>;
    expect(stored).toMatchObject({ crm_contact_id: s.hiddenContact.id, crm_company_id: s.hiddenCompany.id });
  });

  it('el log del chat: un cambio de vínculo no trae los ids que el miembro no ve', async () => {
    const s = await setup('lcrm-audit');
    session.user = owner(s);
    expect((await chatRoute.PATCH(req('PATCH', `/api/groups/chats/${s.mine.id}`, { crmCompanyId: s.hiddenCompany.id }), ctx(s.mine.id))).status).toBe(200);
    const entriesAs = async (user: SessionUser) => {
      session.user = user;
      const res = await auditRoute.GET(req('GET', `/api/groups/audit?chat=${s.mine.id}`));
      return ((await res.json()) as { entries: Array<{ action: string; detail: Record<string, unknown> }> }).entries.filter((e) => e.action === 'crm_link');
    };
    const mine = await entriesAs(member(s));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].detail).toMatchObject({ companyId: null, contactId: s.ownContact.id });
    expect(JSON.stringify(mine)).not.toContain(s.hiddenCompany.id);
    expect((await entriesAs(owner(s)))[0].detail).toMatchObject({ companyId: s.hiddenCompany.id });
  });

  it('API v1 con la key de un miembro: lista y chat sin los ids que no ve', async () => {
    const s = await setup('lcrm-v1');
    const key = await createApiKey(s.ws, 'k', s.w.member.id, ['groups:read']);
    const auth = { authorization: `Bearer ${key.key}` };
    const list = (await (await v1ChatsRoute.GET(req('GET', '/api/v1/groups/chats?filter=all', undefined, auth))).json()) as { data: ChatOut[] };
    expect(list.data.find((c) => c.id === s.linked.id)).toMatchObject({ crmContactId: null, crmCompanyId: null });
    expect(list.data.find((c) => c.id === s.mine.id)).toMatchObject({ crmContactId: s.ownContact.id });
    const one = (await (await v1ChatRoute.GET(req('GET', `/api/v1/groups/chats/${s.linked.id}`, undefined, auth), ctx(s.linked.id))).json()) as { data: ChatOut };
    expect(one.data).toMatchObject({ crmContactId: null, crmCompanyId: null });
  });

  it('la timeline de un contacto que ve no trae la empresa que no ve del mismo chat', async () => {
    const s = await setup('lcrm-tl');
    await getDb().prepare('UPDATE groups_chats SET crm_company_id = ? WHERE id = ?').run(s.hiddenCompany.id, s.mine.id);
    const viewer: GroupsViewer = { ws: s.ws, me: s.w.member.id, role: 'member', restricted: false, mask: false, linesScoped: true };
    const out = await chatsForCrmRecord(s.ws, 'contact', s.ownContact.id, 1, viewer);
    expect(out.map((o) => o.chat.id)).toEqual([s.mine.id]);
    expect(out[0].chat).toMatchObject({ crmContactId: s.ownContact.id, crmCompanyId: null });
  });

  it('un invitado no recibe vínculos; el sistema (cron, Flow) los ve todos', async () => {
    const s = await setup('lcrm-guest');
    const chats = [{ crmContactId: s.ownContact.id, crmCompanyId: s.hiddenCompany.id }];
    const guest: GroupsViewer = { ws: s.ws, me: s.w.friend.id, role: 'guest', restricted: true, mask: true, linesScoped: true };
    expect(await scopeChatCrmRefs(guest, chats)).toEqual([{ crmContactId: null, crmCompanyId: null }]);
    expect(await scopeChatCrmRefs(systemViewer(s.ws), chats)).toEqual(chats);
    expect(await scopeChatCrmRefs(null, chats)).toEqual(chats);
  });

  it('crear un grupo vinculado a una empresa que no ve no la vincula; el owner sí', async () => {
    const s = await setup('lcrm-new');
    await connectNumber(s.ws, s.n.id);
    const state = (globalThis as unknown as { __groupsFake?: Map<string, { connectedAt?: number }> }).__groupsFake?.get(s.n.id);
    if (state) state.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = '15550000001' WHERE id = ?").run(s.n.id);
    const make = async (user: SessionUser, name: string) => {
      session.user = user;
      const res = await createRoute.POST(req('POST', '/api/groups/create', { numberId: s.n.id, name, phones: ['5491100000001'], crmCompanyId: s.hiddenCompany.id }));
      expect(res.status).toBe(201);
      expect(((await res.json()) as { results: Array<{ ok: boolean }> }).results[0]?.ok).toBe(true);
      return (await getDb().prepare('SELECT crm_company_id FROM groups_chats WHERE user_id = ? AND name = ?').get(s.ws, name)) as { crm_company_id: string | null } | undefined;
    };
    const fromMember = await make(member(s), 'From member');
    expect(fromMember).toBeDefined();
    expect(fromMember?.crm_company_id).toBeNull();
    expect((await make(owner(s), 'From owner'))?.crm_company_id).toBe(s.hiddenCompany.id);
  });
});
