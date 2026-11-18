import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { cleanPresence, presenceOf, receivesNewChats } from '@/lib/groups-inbox-rules';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, updateChat } from '@/lib/groups';
import { createRule, getPresence, listRules, reassignOnOffline, setPresence, updateRule } from '@/lib/groups-inbox';
import migration from '@/lib/schema/migration-files/20261118_2031_groups_presence';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

async function setup(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return { user, row: (await getNumberRowById(n.id))! };
}

async function addTeammate(ownerId: string, label: string) {
  const mate = await makeUser(label);
  const db = getDb();
  const team = (await db.prepare('SELECT id FROM teams WHERE owner_id = ?').get(ownerId)) as { id: string } | undefined;
  const teamId = team?.id ?? crypto.randomUUID();
  if (!team) await db.prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').run(teamId, 'T', ownerId);
  await db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").run(teamId, mate.id);
  return mate;
}

const inbound = (chatId: string, id: string, body: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: false,
  fromMe: false,
  senderPhone: chatId.replace('@c.us', ''),
  senderName: 'Demo',
  providerMessageId: id,
  body,
});

const chatsOf = async (ws: string) => (await listChats(ws, ws)).rows;

describe('estado online / away / offline (puro)', () => {
  it('lee filas nuevas y viejas; sin fila es online', () => {
    expect(presenceOf(undefined)).toBe('online');
    expect(presenceOf({ status: 'away', available: 0 })).toBe('away');
    expect(presenceOf({ status: null, available: 1 })).toBe('online');
    expect(presenceOf({ status: null, available: 0 })).toBe('offline');
    expect(presenceOf({ status: 'raro', available: 0 })).toBe('offline');
    expect(cleanPresence('offline')).toBe('offline');
    expect(cleanPresence('busy')).toBeNull();
    expect(cleanPresence(1)).toBeNull();
  });

  it('solo online recibe chats nuevos', () => {
    expect(receivesNewChats('online')).toBe(true);
    expect(receivesNewChats(undefined)).toBe(true);
    expect(receivesNewChats('away')).toBe(false);
    expect(receivesNewChats('offline')).toBe(false);
  });
});

describe('migración de disponible a estado', () => {
  it('disponible → online, no disponible → offline, y tolera correr dos veces', async () => {
    const user = await makeUser('presence-mig');
    const a = await makeUser('presence-mig-a');
    const b = await makeUser('presence-mig-b');
    const db = getDb();
    await db.prepare('INSERT INTO groups_availability (user_id, person_id, available, status) VALUES (?, ?, 1, NULL), (?, ?, 0, NULL)').run(user.id, a.id, user.id, b.id);
    const client = { execute: async (sql: string) => void (await getDb().prepare(sql).run()) };
    await migration.up(client as unknown as Parameters<typeof migration.up>[0]);
    await migration.up(client as unknown as Parameters<typeof migration.up>[0]);
    expect(await getPresence(user.id)).toEqual({ [a.id]: 'online', [b.id]: 'offline' });
  });
});

describe('asignación según el estado', () => {
  it('away conserva sus chats y no recibe nuevos; vuelve online y recibe', async () => {
    const { user, row } = await setup('presence-away');
    const a = await addTeammate(user.id, 'presence-away-a');
    const b = await addTeammate(user.id, 'presence-away-b');
    await createRule(user.id, { name: 'Todos', personIds: [a.id, b.id] });
    await setPresence(user.id, b.id, 'away');
    await ingestEvents(row, [inbound('5490000000101@c.us', 'P-1', 'uno'), inbound('5490000000102@c.us', 'P-2', 'dos')]);
    expect((await chatsOf(user.id)).map((c) => c.assignedTo)).toEqual([a.id, a.id]);

    // a pasa a away: sus chats quedan con a, y el nuevo espera sin nadie.
    await setPresence(user.id, a.id, 'away');
    await ingestEvents(row, [inbound('5490000000103@c.us', 'P-3', 'tres')]);
    const rows = await chatsOf(user.id);
    expect(rows.filter((c) => c.assignedTo === a.id)).toHaveLength(2);
    const waiting = rows.find((c) => c.phone === '5490000000103')!;
    expect(waiting.assignedTo).toBeNull();
    await setPresence(user.id, b.id, 'online');
    expect((await chatsOf(user.id)).find((c) => c.id === waiting.id)?.assignedTo).toBe(b.id);
  });
});

describe('reasignar al desconectarse', () => {
  it('apagado por defecto: offline conserva sus chats', async () => {
    const { user, row } = await setup('presence-keep');
    const a = await addTeammate(user.id, 'presence-keep-a');
    const b = await addTeammate(user.id, 'presence-keep-b');
    const rule = await createRule(user.id, { name: 'Todos', personIds: [a.id, b.id] });
    expect(rule.reassignOffline).toBe(false);
    await setPresence(user.id, b.id, 'away');
    await ingestEvents(row, [inbound('5490000000201@c.us', 'K-1', 'uno')]);
    await setPresence(user.id, b.id, 'online');
    const r = await setPresence(user.id, a.id, 'offline');
    expect(r.reassigned).toBe(0);
    expect((await chatsOf(user.id))[0].assignedTo).toBe(a.id);
  });

  it('con la regla prendida reparte por turno entre los online y deja historial', async () => {
    const { user, row } = await setup('presence-move');
    const a = await addTeammate(user.id, 'presence-move-a');
    const b = await addTeammate(user.id, 'presence-move-b');
    const c = await addTeammate(user.id, 'presence-move-c');
    const rule = await createRule(user.id, { name: 'Soporte', personIds: [a.id, b.id, c.id], reassignOffline: true });
    expect(rule.reassignOffline).toBe(true);
    // Todo a a: b y c ausentes mientras llegan los chats.
    await setPresence(user.id, b.id, 'away');
    await setPresence(user.id, c.id, 'away');
    await ingestEvents(row, [
      inbound('5490000000301@c.us', 'M-1', 'uno'),
      inbound('5490000000302@c.us', 'M-2', 'dos'),
      inbound('5490000000303@c.us', 'M-3', 'tres'),
      inbound('5490000000304@c.us', 'M-4', 'cuatro'),
    ]);
    const before = await chatsOf(user.id);
    expect(before.every((x) => x.assignedTo === a.id)).toBe(true);
    // Un chat cerrado no se mueve.
    await updateChat(user.id, before[0].id, { status: 'closed' }, user.id);

    await setPresence(user.id, b.id, 'online');
    await setPresence(user.id, c.id, 'online');
    const r = await setPresence(user.id, a.id, 'offline');
    expect(r.reassigned).toBe(3);
    const open = await chatsOf(user.id);
    const counts = new Map<string | null, number>();
    for (const x of open) counts.set(x.assignedTo, (counts.get(x.assignedTo) ?? 0) + 1);
    expect(counts.get(a.id)).toBeUndefined();
    expect((counts.get(b.id) ?? 0) + (counts.get(c.id) ?? 0)).toBe(3);
    expect(Math.abs((counts.get(b.id) ?? 0) - (counts.get(c.id) ?? 0))).toBeLessThanOrEqual(1);
    const closed = (await listChats(user.id, user.id, { filter: 'closed' })).rows[0];
    expect(closed.assignedTo).toBe(a.id);

    const ev = (await listMessages(user.id, open[0].id)).find((m) => m.meta.event === 'reassigned_offline');
    expect(ev?.meta).toMatchObject({ from: a.id, to: open[0].assignedTo, rule: 'Soporte' });

    // Pasar a offline de nuevo no hace nada (ya estaba offline).
    expect((await setPresence(user.id, a.id, 'offline')).reassigned).toBe(0);
  });

  it('sin nadie online conserva los chats; away no reparte', async () => {
    const { user, row } = await setup('presence-alone');
    const a = await addTeammate(user.id, 'presence-alone-a');
    const b = await addTeammate(user.id, 'presence-alone-b');
    const rule = await createRule(user.id, { name: 'Solo', personIds: [a.id, b.id] });
    await updateRule(user.id, rule.id, { reassignOffline: true });
    expect((await listRules(user.id))[0].reassignOffline).toBe(true);
    await setPresence(user.id, b.id, 'away');
    await ingestEvents(row, [inbound('5490000000401@c.us', 'A-1', 'uno')]);
    expect((await setPresence(user.id, a.id, 'away')).reassigned).toBe(0);
    expect((await setPresence(user.id, a.id, 'offline')).reassigned).toBe(0);
    expect((await chatsOf(user.id))[0].assignedTo).toBe(a.id);
  });

  it('un chat que otro reasignó a mano mientras tanto queda como está (claim)', async () => {
    const { user, row } = await setup('presence-claim');
    const a = await addTeammate(user.id, 'presence-claim-a');
    const b = await addTeammate(user.id, 'presence-claim-b');
    await createRule(user.id, { name: 'Todos', personIds: [a.id, b.id], reassignOffline: true });
    await setPresence(user.id, b.id, 'away');
    await ingestEvents(row, [inbound('5490000000501@c.us', 'C-1', 'uno')]);
    const chat = (await chatsOf(user.id))[0];
    expect(chat.assignedTo).toBe(a.id);
    await setPresence(user.id, b.id, 'online');
    await updateChat(user.id, chat.id, { assignedTo: user.id }, user.id);
    expect(await reassignOnOffline(user.id, a.id)).toBe(0);
    expect((await chatsOf(user.id))[0].assignedTo).toBe(user.id);
  });

  it('las reglas de otro workspace no mueven nada', async () => {
    const { user, row } = await setup('presence-iso');
    const other = await makeUser('presence-iso-other');
    const a = await addTeammate(user.id, 'presence-iso-a');
    await addTeammate(other.id, 'presence-iso-b');
    await createRule(user.id, { name: 'Todos', personIds: [a.id] });
    await ingestEvents(row, [inbound('5490000000601@c.us', 'I-1', 'uno')]);
    expect(await reassignOnOffline(other.id, a.id)).toBe(0);
    expect((await chatsOf(user.id))[0].assignedTo).toBe(a.id);
  });
});
