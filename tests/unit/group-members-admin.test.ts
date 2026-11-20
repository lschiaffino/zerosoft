/**
 * Miembros de un grupo desde el panel de info (Lines e Inbox): agregar varios,
 * hacer admin, quitar como admin y quitar, con el resultado por persona (la
 * privacidad de WhatsApp rechaza a alguien), el caso en que el número
 * conectado no es admin del grupo (403 not_group_admin), el acceso por línea y
 * "mandar el link" a quien no se pudo agregar. Con el WhatsApp falso; números
 * inventados (los que terminan en 99 los rechaza el falso por privacidad).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, type UserRow } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createGroups, createNumber, getNumberRowById, listMembers } from '@/lib/groups';
import { setLineAccess } from '@/lib/groups-lines';
import { joinGroup } from '@/lib/groups-org';
import { memberRef, participantError } from '@/lib/wa-group-members';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { createWhatsappGroup } from '@/lib/inbox/new-chat';
import { refreshChatInfo, parseThreadInfo } from '@/lib/inbox/wa-meta';
import type { AccountRow, ThreadRow } from '@/lib/inbox/core';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const linesRoute = await import('@/lib/routes/groups/chats/[id]/members/route');
const inboxRoute = await import('@/lib/routes/inbox/threads/[id]/wa/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type FakeState = { connectedAt: number | null; groups: Map<string, { participants: Array<{ phone: string; role: string }> }> };
const fake = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, FakeState> }).__groupsFake.get(id);
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const asOwner = (u: UserRow) => (session.user = { ...u, role: 'owner', apps: '*' });
const asMember = (owner: UserRow, person: UserRow) => (session.user = { ...owner, actingUser: person, role: 'member', apps: '*' });

const A = '15550101001';
const B = '15550101002';
const BLOCKED = '15550101099';

async function linesGroup(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const n = await createNumber(owner.id, owner.id, { provider: 'fake', name: `Linea ${label}` });
  await connectNumber(owner.id, n.id);
  const s = fake(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = '15550000001' WHERE id = ?").run(n.id);
  const [res] = await createGroups(owner.id, n.id, [{ name: `Grupo ${label}`, phones: ['15550101000'] }]);
  return { owner, numberId: n.id, chatId: res.chatId! };
}

async function linesPost(chatId: string, body: unknown) {
  const res = await linesRoute.POST(post(body), ctx(chatId));
  return { status: res.status, data: (await res.json()) as Record<string, unknown> & { result?: { results: Array<Record<string, unknown>> }; members?: Array<Record<string, unknown>>; error?: unknown } };
}

describe('Lines: miembros del grupo desde el panel', () => {
  it('agrega varios con resultado por persona, hace admin, quita como admin y quita', async () => {
    const { owner, chatId } = await linesGroup('lm1');
    asOwner(owner);
    const add = await linesPost(chatId, { action: 'add', phones: [A, B, BLOCKED] });
    expect(add.status).toBe(200);
    expect(add.data.result!.results).toEqual([
      { key: A, phone: A, ok: true },
      { key: B, phone: B, ok: true },
      { key: BLOCKED, phone: BLOCKED, ok: false, error: 'privacy' },
    ]);
    // El número de la línea viene marcado (es el que decide si se puede administrar).
    expect(add.data.members!.find((m) => m.phone === '15550000001')).toMatchObject({ me: true, role: 'superadmin' });

    const promote = await linesPost(chatId, { action: 'promote', phones: [A] });
    expect(promote.data.members!.find((m) => m.phone === A)?.role).toBe('admin');
    const demote = await linesPost(chatId, { action: 'demote', phones: [A] });
    expect(demote.data.members!.find((m) => m.phone === A)?.role).toBe('member');
    const remove = await linesPost(chatId, { action: 'remove', phones: [B] });
    expect(remove.data.members!.some((m) => m.phone === B)).toBe(false);
    expect((await listMembers(owner.id, chatId)).map((m) => m.phone).sort()).toEqual(['15550000001', '15550101000', A].sort());

    // La línea misma no se quita desde acá (eso es "salir del grupo").
    const self = await linesPost(chatId, { action: 'remove', phones: ['15550000001'] });
    expect(self.data.result!.results).toEqual([{ key: '15550000001', phone: '15550000001', ok: false, error: 'own_number' }]);

    // Lo hecho queda en el registro de Lines.
    const audit = (await getDb().prepare("SELECT COUNT(*) AS n FROM groups_audit WHERE chat_id = ? AND action = 'members'").get(chatId)) as { n: number } | undefined;
    expect(Number(audit?.n ?? 0)).toBeGreaterThanOrEqual(4);
  });

  it('actúa con referencias opacas (miembro y chat 1:1) sin pasar el teléfono', async () => {
    const { owner, chatId } = await linesGroup('lm2');
    asOwner(owner);
    await linesPost(chatId, { action: 'add', phones: [A] });
    const res = await linesPost(chatId, { action: 'promote', refs: [memberRef(chatId, A), 'member:nada', 'chat:no-existe'] });
    expect(res.status).toBe(200);
    expect(res.data.members!.find((m) => m.phone === A)?.role).toBe('admin');
    const results = res.data.result!.results;
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => r.error)).toEqual(['not_found', 'not_found']);
  });

  it('si el número de la línea no es admin del grupo: 403 not_group_admin y nada cambia', async () => {
    const { owner, numberId } = await linesGroup('lm3');
    asOwner(owner);
    // Entrar con un link: el falso deja a la línea como miembro común.
    const joined = await joinGroup(owner.id, numberId, 'https://chat.whatsapp.com/NOADMIN1');
    const before = await listMembers(owner.id, joined.id);
    expect(before.find((m) => m.me)?.role).toBe('member');
    for (const action of ['add', 'remove', 'promote', 'demote']) {
      const res = await linesPost(joined.id, { action, phones: [action === 'add' ? A : '15550009000'] });
      expect(res.status).toBe(403);
      expect(res.data.error).toBe('not_group_admin');
    }
    expect(await listMembers(owner.id, joined.id)).toEqual(before);
  });

  it('solo quien ve la línea: anónimo 401, sin acceso 404, con acceso puede', async () => {
    const { owner, numberId, chatId } = await linesGroup('lm4');
    const ana = await makeUser('lm4-ana');
    const beto = await makeUser('lm4-beto');
    const team = await createTeam(owner.id, 'Equipo');
    await addMember(team.id, ana.id, 'member');
    await addMember(team.id, beto.id, 'member');
    await setLineAccess(owner.id, numberId, { ownerId: ana.id, visibility: 'restricted', personIds: [], teamIds: [] });
    session.user = null;
    expect((await linesPost(chatId, { action: 'add', phones: [A] })).status).toBe(401);
    asMember(owner, beto);
    expect((await linesPost(chatId, { action: 'add', phones: [A] })).status).toBe(404);
    asMember(owner, ana);
    const ok = await linesPost(chatId, { action: 'add', phones: [A] });
    expect(ok.status).toBe(200);
    expect(ok.data.result!.results[0]).toMatchObject({ ok: true });
  });

  it('manda el link de invitación por 1:1 a quien WhatsApp no dejó agregar', async () => {
    const { owner, numberId, chatId } = await linesGroup('lm5');
    asOwner(owner);
    const res = await linesPost(chatId, { action: 'inviteSend', phones: [BLOCKED], text: 'Sumate al grupo' });
    expect(res.status).toBe(200);
    expect((res.data as { results: unknown[] }).results).toEqual([{ key: BLOCKED, phone: BLOCKED, ok: true }]);
    const sent = fakeSent(numberId).find((m) => m.chatId.startsWith(BLOCKED));
    expect(sent?.text).toMatch(/^Sumate al grupo\nhttps:\/\/chat\.whatsapp\.com\/FAKE/);
  });
});

async function inboxGroup(label: string) {
  const u = await makeUser(label);
  const { account: acc } = await connectWhatsapp(u.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = '15550000001' WHERE id = ?").run(acc.id);
  const s = fake(`inbox-${acc.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  const account: AccountRow = { ...acc, status: 'connected', address: '15550000001' };
  const thread = await createWhatsappGroup(u.id, { name: `Grupo ${label}`, phones: ['15550101000'] });
  return { u, account, thread };
}

async function inboxPost(threadId: string, body: unknown) {
  const res = await inboxRoute.POST(post(body), ctx(threadId));
  return { status: res.status, data: (await res.json()) as { results?: Array<Record<string, unknown>>; participants?: Array<Record<string, unknown>>; error?: string; link?: string } };
}

describe('Inbox: miembros de un grupo de la cuenta', () => {
  it('agrega varios, hace admin, quita como admin y quita, con los participantes de WhatsApp', async () => {
    const { u, thread } = await inboxGroup('im1');
    session.user = { ...u, role: 'owner', apps: '*' };
    const add = await inboxPost(thread.id, { action: 'members', op: 'add', phones: [A, B, BLOCKED] });
    expect(add.status).toBe(200);
    expect(add.data.results).toEqual([
      { key: A, phone: A, ok: true },
      { key: B, phone: B, ok: true },
      { key: BLOCKED, phone: BLOCKED, ok: false, error: 'privacy' },
    ]);
    expect(add.data.participants!.map((p) => p.phone)).toEqual(expect.arrayContaining([A, B, '15550000001']));
    expect(add.data.participants!.find((p) => p.me)).toMatchObject({ role: 'superadmin' });
    const promote = await inboxPost(thread.id, { action: 'members', op: 'promote', phones: [A] });
    expect(promote.data.participants!.find((p) => p.phone === A)?.role).toBe('admin');
    const demote = await inboxPost(thread.id, { action: 'members', op: 'demote', phones: [A] });
    expect(demote.data.participants!.find((p) => p.phone === A)?.role).toBe('member');
    const remove = await inboxPost(thread.id, { action: 'members', op: 'remove', phones: [B] });
    expect(remove.data.participants!.some((p) => p.phone === B)).toBe(false);
    const link = await inboxPost(thread.id, { action: 'invite' });
    expect(link.data.link).toMatch(/^https:\/\/chat\.whatsapp\.com\//);
    expect((await inboxPost(thread.id, { action: 'members', op: 'nope', phones: [A] })).status).toBe(400);
  });

  it('si la cuenta no es admin del grupo: 403 not_group_admin', async () => {
    const { u, account, thread } = await inboxGroup('im2');
    session.user = { ...u, role: 'owner', apps: '*' };
    const g = fake(`inbox-${account.id}`)!.groups.get(thread.external_id)!;
    g.participants = [
      { phone: '15550009000', role: 'superadmin' },
      { phone: '15550000001', role: 'member' },
    ];
    const row = (await getDb().prepare('SELECT * FROM inbox_threads WHERE id = ?').get(thread.id)) as ThreadRow;
    expect(await refreshChatInfo(account, row)).toBe(true);
    for (const op of ['add', 'remove', 'promote', 'demote']) {
      const res = await inboxPost(thread.id, { action: 'members', op, phones: [A] });
      expect(res.status).toBe(403);
      expect(res.data.error).toBe('not_group_admin');
    }
    const after = (await getDb().prepare('SELECT info FROM inbox_threads WHERE id = ?').get(thread.id)) as { info: string };
    expect(parseThreadInfo(after.info).participants).toHaveLength(2);
  });

  it('el grupo de otra persona no se alcanza', async () => {
    const { thread } = await inboxGroup('im3');
    const other = await makeUser('im3-other');
    session.user = { ...other, role: 'owner', apps: '*' };
    expect((await inboxPost(thread.id, { action: 'members', op: 'add', phones: [A] })).status).toBe(404);
    session.user = null;
    expect((await inboxPost(thread.id, { action: 'members', op: 'add', phones: [A] })).status).toBe(401);
  });
});

describe('motivos por persona', () => {
  it('traduce los status de WhatsApp a motivos que la pantalla explica', () => {
    expect(participantError('whatsapp_403')).toBe('privacy');
    expect(participantError('whatsapp_409')).toBe('already_member');
    expect(participantError('whatsapp_408')).toBe('recently_left');
    expect(participantError('whatsapp_401')).toBe('not_group_admin');
    expect(participantError('not_member')).toBe('not_member');
    expect(participantError('raro')).toBe('failed');
  });
});
