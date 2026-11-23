/**
 * Lines: lo que devuelven las acciones sobre un mensaje (reaccionar,
 * destacar, fijar, editar, crear ticket, reenviar, borrar) pasa por la
 * máscara de teléfonos de quien pide, como el hilo. Miradas: anónimo, otro
 * workspace, miembro con teléfonos ocultos y owner. Teléfonos de prueba
 * (555), datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages } from '@/lib/groups';
import { groupsViewer, updatePlatformSettings } from '@/lib/groups-access';
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
  // Un 1:1 sin nombre (su nombre es el teléfono) para reenviarle.
  await ingestEvents(row, [ev({ chatId: `${SENDER}@s.whatsapp.net`, isGroup: false, chatName: '', body: 'dm' })]);
  const chats = (await listChats(ws, ws, {})).rows;
  const chat = chats.find((c) => c.name === `Suppliers ${label}`)!;
  const dm = chats.find((c) => c.kind === 'dm' && c.phone === SENDER)!;
  const msgs = await listMessages(ws, chat.id);
  const byBody = (b: string) => msgs.find((m) => m.body === b)!;
  return { w, ws, chat, dm, first: byBody('prices'), second: byBody('second'), third: byBody('third') };
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
    const forwarded = await call('POST', s.second.id, { action: 'forward', chatIds: [s.dm.id] });
    expect(forwarded.status).toBe(200);
    const fwd = (await forwarded.clone().json()) as { results: Array<{ chatId: string; name: string }> };
    expect(fwd.results.map((r) => r.chatId)).toEqual([s.dm.id]);
    bodies.push(await forwarded.text());
    // Los tickets por su propia ruta: alta y cambio.
    const ticketsRoute = await import('@/app/api/groups/tickets/route');
    const ticketRoute = await import('@/lib/routes/groups/tickets/[id]/route');
    const created = await ticketsRoute.POST(new Request('http://localhost/api/groups/tickets', { method: 'POST', body: JSON.stringify({ chatId: s.dm.id }), headers: { 'content-type': 'application/json' } }));
    expect(created.status).toBeLessThan(300);
    const ticket = (await created.clone().json()) as { id: string };
    bodies.push(await created.text());
    const patched = await ticketRoute.PATCH(
      new Request(`http://localhost/api/groups/tickets/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ priority: 'high' }), headers: { 'content-type': 'application/json' } }),
      ctx(ticket.id),
    );
    expect(patched.status).toBe(200);
    bodies.push(await patched.text());
    // Cambiar la prioridad no registra un cambio de título ni guarda el teléfono de más en el registro.
    const log = (await getDb().prepare("SELECT detail FROM groups_audit WHERE chat_id = ? AND action = 'ticket_updated'").all(s.dm.id)) as Array<{ detail: string }>;
    expect(log.length).toBeGreaterThan(0);
    for (const l of log) expect(l.detail).not.toContain('title');
    // El registro del chat, leído por quien no ve teléfonos: sin el teléfono (ni en el detalle de un renombre).
    await getDb()
      .prepare("INSERT INTO groups_audit (id, user_id, chat_id, chat_name, actor_id, actor_kind, action, detail, created_at) VALUES (?, ?, ?, ?, ?, 'user', 'renamed', ?, ?)")
      .run(crypto.randomUUID(), s.ws, s.dm.id, `+${SENDER}`, s.ws, JSON.stringify({ from: `+${SENDER}`, to: 'Client' }), new Date().toISOString());
    const auditRoute = await import('@/app/api/groups/audit/route');
    const audit = await auditRoute.GET(new Request(`http://localhost/api/groups/audit?chat=${s.dm.id}`));
    expect(audit.status).toBe(200);
    const auditText = await audit.text();
    expect(auditText).toContain('renamed');
    bodies.push(auditText);
    for (const text of bodies) expect(text).not.toContain(SENDER);
    expect(bodies[0]).toContain('"senderPhone"');
  });

  it('la lista: quien mandó el último mensaje de un grupo sale enmascarado', async () => {
    const s = await setup('lmask-list');
    const viewer = await groupsViewer(s.ws, s.w.member.id, 'member');
    const rows = (await listChats(s.ws, s.w.member.id, { viewer })).rows;
    const group = rows.find((r) => r.id === s.chat.id) as { lastSender?: string | null } | undefined;
    expect(group).toBeDefined();
    expect(group?.lastSender).toMatch(/•••/);
    expect(JSON.stringify(rows)).not.toContain(SENDER);
  });

  it('el owner (sin máscara) recibe el teléfono como siempre', async () => {
    const s = await setup('lmask-own');
    session.user = asOwner(s.w.owner);
    const res = await call('POST', s.third.id, { action: 'star' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { senderPhone: string }).senderPhone).toBe(SENDER);
  });
});
