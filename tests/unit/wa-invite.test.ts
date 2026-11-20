/**
 * Invitaciones a grupos de WhatsApp en los chats (Lines e Inbox): encontrar
 * el link en el texto (con y sin /invite/, con puntuación pegada, varios
 * links), limpiar el título de la vista previa, entrar con la línea o la
 * cuenta por el proveedor falso (entra, link inválido, ya está, pide
 * aprobación), lo que Evolution devuelve al fallar, y quién puede entrar.
 * Códigos, nombres y números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { connectNumber, createNumber, getNumberRowById, type NumberRow } from '@/lib/groups';
import { setLineAccess } from '@/lib/groups-lines';
import { joinGroup } from '@/lib/groups-org';
import { inviteFailureOf, type FetchLike } from '@/lib/groups-provider';
import { evolutionProvider } from '@/lib/groups-provider-bridge';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { getAccountById, upsertThread } from '@/lib/inbox/core';
import { joinWhatsappGroup } from '@/lib/inbox/new-chat';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { cleanInviteTitle, inviteCodeOfUrl, inviteLinks, isInviteUrl } from '@/lib/wa-invite';
import { previewUrl } from '@/components/groups/wa/format';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const linesJoin = await import('@/app/api/groups/join/route');
const inboxJoin = await import('@/app/api/inbox/groups/join/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
});

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function line(ws: string, name: string): Promise<NumberRow> {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return (await getNumberRowById(n.id))!;
}

async function inboxAccount(ownerId: string) {
  const { account: a } = await connectWhatsapp(ownerId);
  const s = fakeState(`inbox-${a.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = '15550000001' WHERE id = ?").run(a.id);
  const account = (await getAccountById(a.id))!;
  const thread = await upsertThread(account, { externalId: '15550004001@s.whatsapp.net', kind: 'dm', title: 'Cliente Prueba', handle: '15550004001' });
  return { account, thread };
}

const post = (route: { POST: (req: Request) => Promise<Response> }, body: unknown) =>
  route.POST(new Request('http://x/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

describe('links de invitación en el texto', () => {
  it('encuentra las dos formas del link, sin la puntuación del final y sin repetir', () => {
    const text = 'Sumate: https://chat.whatsapp.com/AbCdEf123456. También chat.whatsapp.com/invite/XyZ987654321, y otra vez https://chat.whatsapp.com/AbCdEf123456!';
    expect(inviteLinks(text)).toEqual([
      { url: 'https://chat.whatsapp.com/AbCdEf123456', code: 'AbCdEf123456' },
      { url: 'https://chat.whatsapp.com/XyZ987654321', code: 'XyZ987654321' },
    ]);
    expect(inviteLinks('(https://chat.whatsapp.com/invite/Qq1_Ww2-Ee3)')[0]?.code).toBe('Qq1_Ww2-Ee3');
    expect(inviteLinks('https://chat.whatsapp.com/AbCdEf123456?mode=ac_t')[0]?.code).toBe('AbCdEf123456');
  });

  it('no confunde otros links ni códigos cortos', () => {
    expect(inviteLinks('https://example.com/chat.whatsapp.com')).toEqual([]);
    expect(inviteLinks('https://fakechat.whatsapp.com/AbCdEf123456')).toEqual([]);
    expect(inviteLinks('https://chat.whatsapp.com/abc')).toEqual([]);
    expect(inviteLinks('https://wa.me/15550000000')).toEqual([]);
    expect(inviteLinks('')).toEqual([]);
  });

  it('reconoce la URL de una vista previa y elige la invitación para la tarjeta', () => {
    expect(isInviteUrl('https://chat.whatsapp.com/AbCdEf123456')).toBe(true);
    expect(inviteCodeOfUrl('https://chat.whatsapp.com/invite/AbCdEf123456/')).toBe('AbCdEf123456');
    expect(isInviteUrl('https://chat.whatsapp.com/')).toBe(false);
    expect(isInviteUrl('https://whatsapp.com/AbCdEf123456')).toBe(false);
    expect(isInviteUrl('javascript:alert(1)')).toBe(false);
    // Con un link común antes, la tarjeta es la de la invitación.
    expect(previewUrl('Mirá https://example.com/a y entrá a https://chat.whatsapp.com/AbCdEf123456')).toBe('https://chat.whatsapp.com/AbCdEf123456');
    expect(previewUrl('Mirá https://example.com/a.')).toBe('https://example.com/a');
  });

  it('el nombre del grupo sale del título sin el "WhatsApp Group Invite"', () => {
    expect(cleanInviteTitle('Club de Lectura | WhatsApp Group Invite')).toBe('Club de Lectura');
    expect(cleanInviteTitle('WhatsApp Group Invite - Club de Lectura')).toBe('Club de Lectura');
    expect(cleanInviteTitle('Club de Lectura · Invitación a grupo de WhatsApp')).toBe('Club de Lectura');
    expect(cleanInviteTitle('Convite para grupo do WhatsApp: Clube do Livro')).toBe('Clube do Livro');
    expect(cleanInviteTitle('  Vecinos  -  Edificio 4 ')).toBe('Vecinos - Edificio 4');
    expect(cleanInviteTitle('WhatsApp Group Invite')).toBe('');
    expect(cleanInviteTitle('WhatsApp')).toBe('');
    expect(cleanInviteTitle(undefined)).toBe('');
  });
});

describe('entrar con el link', () => {
  it('Lines, con el falso: entra y trae el chat; link inválido, ya está, pide aprobación', async () => {
    const u = await makeUser('inv-lines');
    const n = await line(u.id, 'Ventas');
    const chat = await joinGroup(u.id, n.id, 'https://chat.whatsapp.com/JoinTest12345');
    expect(chat).toMatchObject({ kind: 'group', status: 'open', numberId: n.id });
    await expect(joinGroup(u.id, n.id, 'https://chat.whatsapp.com/JoinTest12345')).rejects.toMatchObject({ code: 'invite_already_member', status: 409 });
    await expect(joinGroup(u.id, n.id, 'https://chat.whatsapp.com/badInvite123')).rejects.toMatchObject({ code: 'invite_invalid', status: 400 });
    await expect(joinGroup(u.id, n.id, 'https://chat.whatsapp.com/approveMe12345')).rejects.toMatchObject({ code: 'invite_approval_required', status: 409 });
    await expect(joinGroup(u.id, n.id, 'https://example.com/x')).rejects.toMatchObject({ code: 'invalid_invite' });
  });

  it('Inbox, con el falso: entra con la cuenta del chat y devuelve el grupo; los mismos errores', async () => {
    const u = await makeUser('inv-inbox');
    const { account, thread } = await inboxAccount(u.id);
    const t = await joinWhatsappGroup(u.id, { invite: 'https://chat.whatsapp.com/invite/InboxJoin1234', threadId: thread.id });
    expect(t).toMatchObject({ kind: 'group', account_id: account.id, owner_id: u.id });
    expect(t.external_id).toMatch(/@g\.us$/);
    await expect(joinWhatsappGroup(u.id, { invite: 'https://chat.whatsapp.com/InboxJoin1234', threadId: thread.id })).rejects.toMatchObject({ code: 'invite_already_member', status: 409 });
    await expect(joinWhatsappGroup(u.id, { invite: 'https://chat.whatsapp.com/badInvite123' })).rejects.toMatchObject({ code: 'invite_invalid', status: 400 });
    await expect(joinWhatsappGroup(u.id, { invite: 'https://chat.whatsapp.com/approveMe12345' })).rejects.toMatchObject({ code: 'invite_approval_required' });
    await expect(joinWhatsappGroup(u.id, { invite: 'hola' })).rejects.toMatchObject({ code: 'invalid_invite' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'disconnected' WHERE id = ?").run(account.id);
    await expect(joinWhatsappGroup(u.id, { invite: 'https://chat.whatsapp.com/Another12345' })).rejects.toMatchObject({ code: 'not_connected', status: 409 });
  });

  it('Evolution: acceptInviteCode, y sus errores reducidos a una etiqueta', async () => {
    const cfg = { baseUrl: 'https://gw.example.com', apiKey: 'k', session: 'acme' };
    const reply = (status: number, body: unknown): FetchLike => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    expect(await evolutionProvider(cfg, { fetch: reply(200, { accepted: true, groupJid: '120363000000000077@g.us' }) }).joinGroup('AbCdEf123')).toEqual({ id: '120363000000000077@g.us' });
    const fails = async (status: number, body: unknown) => {
      try {
        await evolutionProvider(cfg, { fetch: reply(status, body) }).joinGroup('AbCdEf123');
      } catch (e) {
        return (e as { reason?: string; code: string }).reason ?? (e as { code: string }).code;
      }
      return 'ok';
    };
    expect(await fails(404, { response: { message: ['Accept invite error', 'Error: not-authorized'] } })).toBe('invite_invalid');
    expect(await fails(400, { response: { message: ['Error: conflict'] } })).toBe('already_member');
    // Aceptada sin grupo: quedó la solicitud para que un admin la apruebe.
    expect(await fails(200, { accepted: true })).toBe('approval_required');
    expect(await fails(500, { error: 'boom' })).toBe('provider_error');
    expect(inviteFailureOf('item-not-found')).toBe('invite_invalid');
    expect(inviteFailureOf('bad-request')).toBe('invite_invalid');
    expect(inviteFailureOf('')).toBeUndefined();
  });
});

describe('quién puede entrar', () => {
  it('Lines: quien ve la línea; una línea privada o de otro workspace no, y sin sesión 401', async () => {
    const w = await workspaceWithMember('inv-acc');
    const pub = await line(w.owner.id, 'Pública');
    const priv = await line(w.owner.id, 'Privada');
    await setLineAccess(w.owner.id, priv.id, { ownerId: w.friend.id, visibility: 'restricted', personIds: [], teamIds: [] });
    const body = (numberId: string, code: string) => ({ numberId, invite: `https://chat.whatsapp.com/${code}` });

    session.user = null;
    expect((await post(linesJoin, body(pub.id, 'Access000001'))).status).toBe(401);
    session.user = asOwner(w.stranger);
    expect((await post(linesJoin, body(pub.id, 'Access000002'))).status).toBe(404);
    session.user = asMember(w.owner, w.member);
    expect((await post(linesJoin, body(priv.id, 'Access000003'))).status).toBe(404);
    expect((await post(linesJoin, body(pub.id, 'Access000004'))).status).toBe(201);
    session.user = asMember(w.owner, w.friend);
    expect((await post(linesJoin, body(priv.id, 'Access000005'))).status).toBe(201);
    session.user = asOwner(w.owner);
    const r = await post(linesJoin, body(priv.id, 'badAccess0006'));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'invite_invalid' });
  });

  it('Inbox: solo la dueña de la cuenta; el chat de otra persona da 404 y sin sesión 401', async () => {
    const owner = await makeUser('inv-ib-owner');
    const other = await makeUser('inv-ib-other');
    const { thread } = await inboxAccount(owner.id);
    const body = { invite: 'https://chat.whatsapp.com/InboxAcc00001', threadId: thread.id };

    session.user = null;
    expect((await post(inboxJoin, body)).status).toBe(401);
    session.user = asOwner(other);
    expect((await post(inboxJoin, body)).status).toBe(404);
    // Sin chat: la cuenta de WhatsApp de quien pide (no tiene).
    expect((await post(inboxJoin, { invite: body.invite })).status).toBe(404);
    session.user = asOwner(owner);
    const ok = await post(inboxJoin, body);
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { thread: { kind: string } }).thread).toMatchObject({ kind: 'group' });
    const again = await post(inboxJoin, body);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'invite_already_member' });
  });
});
