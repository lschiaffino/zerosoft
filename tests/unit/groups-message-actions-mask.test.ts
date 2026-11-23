/**
 * Lines: lo que devuelven las acciones sobre un mensaje (reaccionar,
 * destacar, fijar, editar, crear ticket, reenviar, borrar) pasa por la
 * máscara de teléfonos de quien pide, como el hilo. Miradas: anónimo, otro
 * workspace, miembro con teléfonos ocultos y owner. Teléfonos de prueba
 * (555), datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages } from '@/lib/groups';
import { updatePlatformSettings } from '@/lib/groups-access';
import type { InboundEvent } from '@/lib/groups-provider';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const messageRoute = await import('@/lib/routes/groups/messages/[id]/route');

beforeEach(() => {
  session.user = null;
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const SENDER = '15550101777';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const call = (method: 'POST' | 'DELETE', id: string, body?: unknown) =>
  (method === 'POST' ? messageRoute.POST : messageRoute.DELETE)(
    new Request(`http://localhost/api/groups/messages/${id}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { 'content-type': 'application/json' },
    }),
    ctx(id),
  );

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  await updatePlatformSettings(ws, { maskRoles: ['member'] });
  const n = await createNumber(ws, ws, { provider: 'fake' });
  await connectNumber(ws, n.id);
  const state = (globalThis as unknown as { __groupsFake?: Map<string, { connectedAt?: number }> }).__groupsFake?.get(n.id);
  if (state) state.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = '15550000001' WHERE id = ?").run(n.id);
  const jid = `1203630${Date.now()}${Math.floor(Math.random() * 1000)}@g.us`;
  const ev = (over: Record<string, unknown>) =>
    ({
      type: 'message',
      chatId: jid,
      isGroup: true,
      chatName: `Suppliers ${label}`,
      fromMe: false,
      senderPhone: SENDER,
      senderName: '',
      providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
      body: 'prices',
      timestamp: new Date().toISOString(),
      ...over,
    }) as InboundEvent;
  const row = (await getNumberRowById(n.id))!;
  await ingestEvents(row, [ev({}), ev({ body: 'second' }), ev({ body: 'third' })]);
  const chat = (await listChats(ws, ws, { kind: 'group' })).rows.find((c) => c.name === `Suppliers ${label}`)!;
  const msgs = await listMessages(ws, chat.id);
  const byBody = (b: string) => msgs.find((m) => m.body === b)!;
  return { w, ws, chat, first: byBody('prices'), second: byBody('second'), third: byBody('third') };
}

describe('Lines: acciones sobre un mensaje con la máscara de quien pide', () => {
  it('anónimo 401 y otro workspace 404', async () => {
    const s = await setup('lmask-anon');
    expect((await call('POST', s.first.id, { action: 'star' })).status).toBe(401);
    session.user = asOwner(s.w.stranger);
    expect((await call('POST', s.first.id, { action: 'star' })).status).toBe(404);
  });

  it('un miembro con teléfonos ocultos no recibe el teléfono en ninguna respuesta', async () => {
    const s = await setup('lmask-mem');
    session.user = asMember(s.w.owner, s.w.member);
    const bodies: string[] = [];
    for (const body of [{ action: 'star' }, { action: 'react', emoji: '👍' }, { action: 'pin' }, { action: 'ticket', title: 'Follow up' }]) {
      const res = await call('POST', s.first.id, body);
      expect(res.status).toBeLessThan(300);
      bodies.push(await res.text());
    }
    const forwarded = await call('POST', s.second.id, { action: 'forward', chatIds: [s.chat.id] });
    bodies.push(await forwarded.text());
    for (const text of bodies) expect(text).not.toContain(SENDER);
    expect(bodies[0]).toContain('"senderPhone"');
  });

  it('el owner (sin máscara) recibe el teléfono como siempre', async () => {
    const s = await setup('lmask-own');
    session.user = asOwner(s.w.owner);
    const res = await call('POST', s.third.id, { action: 'star' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { senderPhone: string }).senderPhone).toBe(SENDER);
  });
});
