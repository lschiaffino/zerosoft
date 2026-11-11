import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createLabel, createNumber, getNumberRowById, ingestEvents, listChats, updateChat } from '@/lib/groups';
import { setLabelAccess, updatePlatformSettings } from '@/lib/groups-access';
import { addMessage, createAccount, upsertThread } from '@/lib/inbox/core';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

/**
 * "Ayudame a escribir": quién puede pedir un borrador de qué conversación.
 * Las rutas corren de verdad; lo único simulado es quién está logueado.
 */
const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('@/lib/session', async (original) => ({
  ...(await original<typeof import('@/lib/session')>()),
  getCurrentUser: async () => session.user,
}));
const linesDraft = await import('@/app/api/groups/chats/[id]/draft/route');
const linesTranslate = await import('@/app/api/groups/chats/[id]/translate/route');
const inboxAi = await import('@/app/api/inbox/ai/route');

type Row = Awaited<ReturnType<typeof makeUser>>;
const asOwner = (u: Row) => ({ ...u, role: 'owner' });
const asMember = (owner: Row, member: Row) => ({ ...owner, actingUser: member, role: 'member' });

const post = (body: unknown) => new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_AI_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  session.user = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const msg = (chatId: string, id: string, body: string, senderName: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: false,
  fromMe: false,
  senderPhone: '5491155550000',
  senderName,
  providerMessageId: id,
  body,
});

async function linesWorkspace(label: string) {
  const owner = await makeUser(label);
  const n = await createNumber(owner.id, owner.id, { provider: 'fake' });
  await connectNumber(owner.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  const row = (await getNumberRowById(n.id))!;
  await ingestEvents(row, [msg('5491100000061@c.us', `${label}-1`, 'hola, soy visible', 'Visible Uno'), msg('5491100000062@c.us', `${label}-2`, 'hola, soy oculto', 'Oculto Dos')]);
  const chats = (await listChats(owner.id, owner.id)).rows;
  return { owner, visible: chats.find((c) => c.name === 'Visible Uno')!, hidden: chats.find((c) => c.name === 'Oculto Dos')! };
}

describe('Lines: el borrador solo sale de un chat que la persona ve', () => {
  it('sin sesión responde 401 y no llama a nada', async () => {
    const { visible } = await linesWorkspace('acc-anon');
    const res = await linesDraft.POST(post({ mode: 'draft', instruction: 'hola' }), params(visible.id));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('el dueño pide un borrador de su chat; el de otro workspace es 404', async () => {
    const a = await linesWorkspace('acc-a');
    const b = await linesWorkspace('acc-b');
    session.user = asOwner(a.owner);
    const ok = await linesDraft.POST(post({ mode: 'draft', instruction: 'decile que mañana' }), params(a.visible.id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ text: 'Draft: decile que mañana' });
    const other = await linesDraft.POST(post({ mode: 'draft', instruction: 'contame qué dice' }), params(b.visible.id));
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: 'not_found' });
  });

  it('con acceso por etiqueta, un miembro no saca un borrador (ni una traducción) de un chat que no ve', async () => {
    const { owner, visible, hidden } = await linesWorkspace('acc-label');
    const member = await makeUser('acc-member');
    const team = await createTeam(owner.id, 'Team');
    await addMember(team.id, member.id, 'member');
    const vip = await createLabel(owner.id, { name: 'VIP' });
    await updateChat(owner.id, visible.id, { labelIds: [vip.id] });
    await setLabelAccess(owner.id, vip.id, [member.id]);
    await updatePlatformSettings(owner.id, { labelAccess: true, maskRoles: [] });
    session.user = asMember(owner, member);

    const seen = await linesDraft.POST(post({ mode: 'draft', instruction: 'decile que sí' }), params(visible.id));
    expect(seen.status).toBe(200);
    for (const body of [{ mode: 'draft' }, { mode: 'draft', instruction: 'resumime lo que dijo' }, { mode: 'rewrite', text: 'hola', change: 'fix' }, { mode: 'polish', text: 'hola' }]) {
      const res = await linesDraft.POST(post(body), params(hidden.id));
      expect(res.status, JSON.stringify(body)).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    const tr = await linesTranslate.POST(post({ messageIds: ['x'], to: 'en' }), params(hidden.id));
    expect(tr.status).toBe(404);
    // El dueño sí.
    session.user = asOwner(owner);
    expect((await linesDraft.POST(post({ mode: 'draft', instruction: 'hola' }), params(hidden.id))).status).toBe(200);
  });
});

describe('Inbox: el borrador solo sale de un chat propio', () => {
  async function thread(label: string) {
    const owner = await makeUser(label);
    const acc = await createAccount(owner.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    const t = await upsertThread(acc, { externalId: `54911${Math.floor(Math.random() * 1e8)}@s.whatsapp.net`, kind: 'dm', title: 'Caro' });
    await addMessage(t, { externalId: 'a', fromMe: false, senderName: 'Caro', body: '¿A qué hora es el asado?', sentAt: new Date().toISOString() });
    return { owner, thread: t };
  }

  it('sin sesión responde 401', async () => {
    const { thread: t } = await thread('acc-inbox-anon');
    const res = await inboxAi.POST(post({ action: 'draft', threadId: t.id }));
    expect(res.status).toBe(401);
  });

  it('la dueña del chat recibe el borrador; otra persona recibe 404, también si lo pasa como contexto de una reescritura', async () => {
    const a = await thread('acc-inbox-a');
    const other = await makeUser('acc-inbox-b');
    session.user = asOwner(a.owner);
    const ok = await inboxAi.POST(post({ action: 'draft', threadId: a.thread.id, instruction: 'decile que a las 8' }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ text: 'Borrador: decile que a las 8' });

    session.user = asOwner(other);
    for (const body of [
      { action: 'draft', threadId: a.thread.id },
      { action: 'draft', threadId: a.thread.id, instruction: 'contame qué dice' },
      { action: 'rewrite', threadId: a.thread.id, text: 'hola', mode: 'fix' },
    ]) {
      const res = await inboxAi.POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    // Sin chat (mensaje nuevo o un texto suelto) no hay nada ajeno que leer.
    const fresh = await inboxAi.POST(post({ action: 'new', channel: 'whatsapp', instruction: 'avisale que llego' }));
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ text: 'Borrador: avisale que llego' });
  });

  it('un pedido mal armado es 400, sin detalles', async () => {
    const a = await thread('acc-inbox-bad');
    session.user = asOwner(a.owner);
    for (const body of [{ action: 'draft' }, { action: 'new', channel: 'sms', instruction: 'x' }, { action: 'rewrite', text: 'x', mode: 'pirate' }, { action: 'rewrite', text: 'x', mode: 'custom' }]) {
      const res = await inboxAi.POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_input' });
    }
  });
});
