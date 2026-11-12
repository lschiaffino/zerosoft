/**
 * Lines e Inbox: lo que pasa cuando el proveedor reintenta (el webhook respondió
 * 500) o la pantalla reintenta un envío. Ronda 3 de la revisión. Con el
 * proveedor falso; nombres y números inventados. Corre sobre una base propia.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbFile = vi.hoisted(() => {
  const file = `${(process.env.TMPDIR ?? '/tmp').replace(/\/$/, '')}/zerosoft-retries-${process.pid}-${Date.now()}.db`;
  process.env.TURSO_DATABASE_URL = `file:${file}`;
  return file;
});

import fs from 'fs';
import { getClient, getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, updateSettings, type NumberRow } from '@/lib/groups';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { listThreads, type AccountRow } from '@/lib/inbox/core';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { transientError } from '@/lib/transient-error';
import { runMigrations, MIGRATIONS } from '@/lib/schema/migrations';
import { WA_LIVE_MESSAGE_TRIGGERS } from '@/lib/schema/wa-live-triggers';
import { makeUser } from './helpers';
import { planOf, tableScans } from './read-probe';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/session')>()),
  getCurrentUser: async () => session.user,
}));
const deferred: Array<() => Promise<unknown>> = [];
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (job: (() => unknown) | Promise<unknown>) => {
    deferred.push(() => Promise.resolve(typeof job === 'function' ? job() : job).catch(() => null));
  },
}));
async function flush() {
  while (deferred.length) for (const job of deferred.splice(0)) await job();
}

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  session.user = null;
});
afterEach(async () => {
  await flush();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(() => {
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(`${dbFile}${ext}`, { force: true });
});

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function linesSetup(label: string): Promise<{ ws: string; number: NumberRow }> {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  await connectNumber(u.id, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return { ws: u.id, number: (await getNumberRowById(n.id))! };
}

async function inboxSetup(label: string): Promise<{ owner: string; account: AccountRow }> {
  const u = await makeUser(label);
  const { account } = await connectWhatsapp(u.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  const s = fakeState(`inbox-${account.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  return { owner: u.id, account: { ...account, status: 'connected' } };
}

function message(chatId: string, id: string, over: Record<string, unknown> = {}) {
  return { type: 'message' as const, chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName: 'Vera Prueba', providerMessageId: id, body: 'hola', timestamp: new Date().toISOString(), ...over };
}

async function linesHook(number: NumberRow, events: unknown[], body: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/groups/webhook/[id]/[secret]/route');
  return POST(new Request('http://zerosoft.test/api/groups/webhook/x/y', { method: 'POST', body: JSON.stringify({ events, ...body }) }), {
    params: Promise.resolve({ id: number.id, secret: number.webhook_secret }),
  });
}
async function inboxHook(account: AccountRow, events: unknown[], body: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/inbox/webhook/[id]/[secret]/route');
  return POST(new Request('http://zerosoft.test/api/inbox/webhook/x/y', { method: 'POST', body: JSON.stringify({ events, ...body }) }), {
    params: Promise.resolve({ id: account.id, secret: account.webhook_secret! }),
  });
}
const dbDown = () => Object.assign(new Error('SERVER_ERROR: la base no responde'), { name: 'LibsqlError', code: 'SERVER_ERROR' });

describe('1. el filtro de acceso del aviso busca cada chat por su clave', () => {
  it('no recorre los chats del workspace (ni la tabla de miembros de equipos)', async () => {
    const { chatFilterFor, groupsViewer } = await import('@/lib/groups-access');
    const u = await makeUser('plan');
    const member = await makeUser('plan-member');
    // Un miembro con líneas restringidas y acceso por etiqueta: el filtro más caro.
    const { updatePlatformSettings } = await import('@/lib/groups-access');
    await updatePlatformSettings(u.id, { labelAccess: true });
    const viewer = await groupsViewer(u.id, member.id, 'member');
    const filter = chatFilterFor(viewer)!;
    expect(filter).not.toBeNull();
    // La consulta de verdad, con sus argumentos de verdad: se anota y se mira su plan.
    const client = getClient() as unknown as { execute: (...a: unknown[]) => unknown };
    const original = client.execute;
    const seen: Array<{ sql: string; args: unknown[] }> = [];
    client.execute = (stmt: unknown, args?: unknown) => {
      const st = stmt as { sql: string; args: unknown[] };
      if (/FROM groups_chats c WHERE c\.id IN/.test(st.sql)) seen.push(st);
      return (original as (...a: unknown[]) => unknown).call(client, stmt, args);
    };
    try {
      await filter(['chat-1', 'chat-2', 'chat-3']);
    } finally {
      client.execute = original;
    }
    expect(seen).toHaveLength(1);
    const plan = await planOf(seen[0].sql, seen[0].args as never);
    expect(tableScans(plan)).toEqual([]);
    expect(plan.join(' | ')).toMatch(/sqlite_autoindex_groups_chats_1 \(id=\?\)|USING INTEGER PRIMARY KEY|groups_chats.*\(id=\?\)/);
    expect(plan.join(' | ')).not.toMatch(/idx_groups_chats_number_recent \(user_id=\?\)/);
    expect(plan.join(' | ')).not.toMatch(/SCAN ztm/);
    await updatePlatformSettings(u.id, { labelAccess: false });
  });
});

describe('2. un reintento no rehace lo que falló después de guardar: eso no da 500', () => {
  it('Lines: si falla algo después de guardar el mensaje, se responde 200 y lo de después corre una vez', async () => {
    const { ws, number } = await linesSetup('post-save');
    await updateSettings(ws, { ticketKeywords: ['urgente'] });
    const jid = '5491100098001@s.whatsapp.net';
    await linesHook(number, [message(jid, 'ps-0')]);
    await flush();
    // El ticket por palabra clave falla (la base, justo ahí): el mensaje ya está guardado.
    const tickets = await import('@/lib/groups-tickets');
    vi.spyOn(tickets, 'createTicket').mockRejectedValueOnce(dbDown());
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await linesHook(number, [message(jid, 'ps-1', { body: 'es urgente' })]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, messages: 1 });
    expect(errors.mock.calls.some((c) => String(c[0]).includes('after-response job failed'))).toBe(true);
    // Lo de después (asignación, avisos, eventos) corre una vez para ese mensaje.
    const groups = await import('@/lib/groups');
    const events = await import('@/lib/events');
    const emitted = vi.spyOn(events, 'emitEventSoon');
    await flush();
    expect(emitted.mock.calls.filter((c) => c[1] === 'groups.message.received')).toHaveLength(1);
    // Si igual llegara repetido, cuenta como repetido y no vuelve a correr lo de después.
    const again = await linesHook(number, [message(jid, 'ps-1', { body: 'es urgente' })]);
    expect(await again.json()).toMatchObject({ ok: true, messages: 0, duplicates: 1 });
    await flush();
    expect(emitted.mock.calls.filter((c) => c[1] === 'groups.message.received')).toHaveLength(1);
    const [chat] = (await listChats(ws, ws, {})).rows;
    expect((await listMessages(ws, chat.id, { limit: 10 })).map((m) => m.body)).toEqual(['hola', 'es urgente']);
    void groups;
  });

  it('Inbox: si falla el nombre del chat después de guardar el mensaje, se responde 200', async () => {
    const { owner, account } = await inboxSetup('post-save-inbox');
    const contacts = await import('@/lib/wa-contacts');
    vi.spyOn(contacts, 'lookupContacts').mockRejectedValue(dbDown());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await inboxHook(account, [message('5491100098011@s.whatsapp.net', 'ips-1', { senderName: '' })]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, messages: 1 });
    expect(await listThreads(owner)).toHaveLength(1);
  });
});

describe('3. el historial nunca pide reintento; un mensaje en vivo que no se pudo guardar, sí', () => {
  it('Lines: historial con un mensaje roto → 200 (se cuenta); en vivo por la base → 500; por un evento con forma rara → 200', async () => {
    const { number } = await linesSetup('history-lines');
    const db = await import('@/lib/db');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const history = Array.from({ length: 5 }, (_, i) => message(`54911000981${10 + i}@s.whatsapp.net`, `h-${i}`, { timestamp: old, history: true }));
    // El historial se guarda con insertMessage: que falle uno.
    const groups = await import('@/lib/groups');
    const spy = vi.spyOn(groups, 'insertMessage');
    spy.mockRejectedValueOnce(dbDown());
    const res = await linesHook(number, history, { event: 'messages.set' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, messages: 4, ignored: 1 });
    spy.mockRestore();
    // Mezcla historial + en vivo: falla el en vivo → 500 (y el historial no se pierde por eso).
    vi.spyOn(db, 'dbBatch').mockRejectedValueOnce(dbDown());
    const mixed = await linesHook(number, [message('5491100098120@s.whatsapp.net', 'h-old', { timestamp: old, history: true }), message('5491100098121@s.whatsapp.net', 'live-1')]);
    expect(mixed.status).toBe(500);
    expect(await mixed.json()).toMatchObject({ failed: 1 });
    // Un error que no es pasajero (una forma inesperada): reintentar no lo arregla → 200.
    vi.spyOn(db, 'dbBatch').mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'slice')"));
    expect((await linesHook(number, [message('5491100098122@s.whatsapp.net', 'live-2')])).status).toBe(200);
  });

  it('Inbox: una tanda de historial (messages.set) con un mensaje roto responde 200; un mensaje en vivo por la base, 500', async () => {
    const { account } = await inboxSetup('history-inbox');
    const db = await import('@/lib/db');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    vi.spyOn(db, 'dbBatch').mockRejectedValueOnce(dbDown());
    const batch = Array.from({ length: 5 }, (_, i) => message(`54911000982${10 + i}@s.whatsapp.net`, `ih-${i}`, { timestamp: old }));
    const res = await inboxHook(account, batch, { event: 'messages.set' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, messages: 4 });
    vi.spyOn(db, 'dbBatch').mockRejectedValueOnce(dbDown());
    expect((await inboxHook(account, [message('5491100098220@s.whatsapp.net', 'il-1')])).status).toBe(500);
    vi.spyOn(db, 'dbBatch').mockRejectedValueOnce(Object.assign(new Error('SQLITE_CONSTRAINT: NOT NULL constraint failed'), { code: 'SQLITE_CONSTRAINT' }));
    expect((await inboxHook(account, [message('5491100098221@s.whatsapp.net', 'il-2')])).status).toBe(200);
  });

  it('qué es pasajero', () => {
    expect(transientError(dbDown())).toBe(true);
    expect(transientError(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }))).toBe(true);
    expect(transientError(new TypeError('fetch failed'))).toBe(false);
    expect(transientError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }))).toBe(true);
    expect(transientError(Object.assign(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT' }))).toBe(false);
    expect(transientError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(transientError(new Error('mensaje 12500 inválido'))).toBe(false);
    expect(transientError(null)).toBe(false);
  });
});

describe('4. lo que llega repetido o tarde por un reintento no cambia nada ni vuelve a avisar', () => {
  it('Lines: un voto repetido no vuelve a avisar; una edición o reacción más vieja no pisa una nueva', async () => {
    const { ws, number } = await linesSetup('replay');
    const gid = '120363000000098301@g.us';
    await ingestEvents(number, [message(gid, 'poll-1', { isGroup: true, chatName: 'Encuesta', body: '¿Cuándo?', poll: { question: '¿Cuándo?', options: ['Lunes', 'Martes'], multi: false } })]);
    await flush();
    const events = await import('@/lib/events');
    const emitted = vi.spyOn(events, 'emitEventSoon');
    const vote = { type: 'poll_vote' as const, chatId: gid, pollProviderMessageId: 'poll-1', voterPhone: '5491100098302', voterName: 'Ana', options: ['Lunes'] };
    await ingestEvents(number, [vote]);
    await ingestEvents(number, [vote]);
    expect(emitted.mock.calls.filter((c) => c[1] === 'groups.poll.voted')).toHaveLength(1);
    // Cambia el voto: sí avisa.
    await ingestEvents(number, [{ ...vote, options: ['Martes'] }]);
    expect(emitted.mock.calls.filter((c) => c[1] === 'groups.poll.voted')).toHaveLength(2);

    const dm = '5491100098303@s.whatsapp.net';
    await ingestEvents(number, [message(dm, 'ed-1', { body: 'original' })]);
    const t1 = '2026-11-12T10:00:00.000Z';
    const t2 = '2026-11-12T10:05:00.000Z';
    await ingestEvents(number, [{ type: 'edit', chatId: dm, providerMessageId: 'ed-1', body: 'segunda versión', at: t2 }]);
    // Llega tarde (un reintento) la edición anterior: no pisa.
    await ingestEvents(number, [{ type: 'edit', chatId: dm, providerMessageId: 'ed-1', body: 'primera versión', at: t1 }]);
    const chats = (await listChats(ws, ws, {})).rows;
    const dmChat = chats.find((c) => c.phone === '5491100098303')!;
    const [msg] = await listMessages(ws, dmChat.id, { limit: 5 });
    expect(msg.body).toBe('segunda versión');
    // Reacción: la nueva es 👍; llega tarde la vieja ❤️ de la misma persona: no pisa. Y la misma otra vez no cambia nada.
    const react = (emoji: string, at: string) => ({ type: 'reaction' as const, chatId: dm, targetProviderMessageId: 'ed-1', emoji, senderPhone: '5491100098303', senderName: 'Vera', fromMe: false, at });
    await ingestEvents(number, [react('👍', t2)]);
    const res = await ingestEvents(number, [react('❤️', t1), react('👍', t2)]);
    expect(res.ignored).toBe(2);
    const [after] = await listMessages(ws, dmChat.id, { limit: 5 });
    expect(after.reactions.map((r) => r.emoji)).toEqual(['👍']);
  });
});

describe('6. reintentar un envío no lo manda dos veces', () => {
  it('Lines: el mismo clientId devuelve el mensaje ya guardado y no llama a WhatsApp ni gasta el tope', async () => {
    const { ws, number } = await linesSetup('dedupe-lines');
    await ingestEvents(number, [message('5491100098401@s.whatsapp.net', 'dd-0')]);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    session.user = { id: ws, email: 'dedupe@test.local', name: 'x', team: null, role: 'owner' };
    vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
    const { POST } = await import('@/lib/routes/groups/chats/[id]/messages/route');
    const send = () =>
      POST(new Request(`http://zerosoft.test/api/groups/chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'una vez', clientId: 'cid-dedupe-01' }) }), {
        params: Promise.resolve({ id: chat.id }),
      });
    const sentBefore = fakeSent(number.id).length;
    const a = (await (await send()).json()) as { id: string };
    // Se perdió la respuesta: la pantalla reintenta con el mismo clientId.
    const b = (await (await send()).json()) as { id: string };
    expect(b.id).toBe(a.id);
    expect(fakeSent(number.id).length).toBe(sentBefore + 1);
    const gate = (await getDb().prepare('SELECT COALESCE(SUM(count), 0) AS n FROM rate_limits WHERE key = ?').get(`groups-send:${number.id}`)) as { n: number };
    expect(Number(gate.n)).toBe(1);
    expect((await listMessages(ws, chat.id, { limit: 10 })).filter((m) => m.body === 'una vez')).toHaveLength(1);
    // La consulta del clientId usa el índice único (no recorre los mensajes del chat).
    const plan = await planOf('SELECT * FROM groups_messages WHERE chat_id = ? AND client_id = ?', [chat.id, 'cid-dedupe-01']);
    expect(plan.join(' | ')).toContain('idx_groups_messages_client');
  });

  it('Inbox: el mismo clientId no sale dos veces', async () => {
    const { owner, account } = await inboxSetup('dedupe-inbox');
    await inboxHook(account, [message('5491100098411@s.whatsapp.net', 'idd-0')]);
    const [t] = await listThreads(owner);
    session.user = { id: owner, email: 'dedupe-inbox@test.local', name: 'x', team: null, role: 'owner' };
    const { POST } = await import('@/lib/routes/inbox/threads/[id]/messages/route');
    const send = () =>
      POST(new Request(`http://zerosoft.test/api/inbox/threads/${t.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'una vez', clientId: 'cid-dedupe-02' }) }), {
        params: Promise.resolve({ id: t.id }),
      });
    const key = `inbox-${account.id}`;
    const before = fakeSent(key).length;
    expect((await send()).status).toBe(201);
    const second = await send();
    expect(second.status).toBe(201);
    expect(fakeSent(key).length).toBe(before + 1);
    const page = (await second.json()) as { messages: Array<{ body: string }> };
    expect(page.messages.filter((m) => m.body === 'una vez')).toHaveLength(1);
    const plan = await planOf('SELECT 1 AS ok FROM inbox_messages WHERE thread_id = ? AND client_id = ? AND owner_id = ?', [t.id, 'x', owner]);
    expect(plan.join(' | ')).toContain('idx_inbox_messages_client');
  });
});

describe('8. la revalidación del stream mira lo mismo que la sesión', () => {
  it('cambia de workspace, el workspace pide dos pasos, o le cierran la app → se corta', async () => {
    const { liveAccessNow } = await import('@/lib/wa-live-auth');
    const { createTeam, addMember } = await import('@/lib/teams');
    const boss = await makeUser('reval-boss');
    const person = await makeUser('reval-person');
    const team = await createTeam(boss.id, 'Equipo');
    await addMember(team.id, person.id, 'member');
    await getDb().prepare('UPDATE users SET active_team_id = ? WHERE id = ?').run(team.id, person.id);
    const s = { userId: person.id, sid: null, workspaceId: team.id };
    expect(await liveAccessNow(s, 'groups')).toMatchObject({ ws: boss.id, role: 'member' });
    // Cambió de workspace en otra pestaña.
    await getDb().prepare('UPDATE users SET active_team_id = NULL WHERE id = ?').run(person.id);
    expect(await liveAccessNow(s, 'groups')).toBeNull();
    await getDb().prepare('UPDATE users SET active_team_id = ? WHERE id = ?').run(team.id, person.id);
    // El workspace empezó a pedir dos pasos y la persona no los tiene.
    await getDb().prepare('UPDATE teams SET require_mfa = 1 WHERE id = ?').run(team.id);
    expect(await liveAccessNow(s, 'groups')).toBeNull();
    await getDb().prepare('UPDATE teams SET require_mfa = 0 WHERE id = ?').run(team.id);
    // Le sacan Lines (sus apps en el equipo).
    await getDb().prepare(`UPDATE team_members SET apps = '["crm"]' WHERE team_id = ? AND user_id = ?`).run(team.id, person.id);
    expect(await liveAccessNow(s, 'groups')).toBeNull();
    await getDb().prepare(`UPDATE team_members SET apps = '*' WHERE team_id = ? AND user_id = ?`).run(team.id, person.id);
    expect(await liveAccessNow(s, 'groups')).toMatchObject({ ws: boss.id });
  });
});

describe('9. la migración 394 se puede correr de nuevo sobre una base que corrió una versión anterior', () => {
  it('deja la columna, los índices y los triggers como en una base nueva', async () => {
    const c = getClient();
    // Una base de desarrollo con la versión anterior: sin client_id ni el índice, con un trigger viejo.
    await c.execute("DELETE FROM schema_migrations WHERE id = '394_wa_live_kinds'");
    await c.execute('DROP INDEX IF EXISTS idx_groups_messages_client');
    await c.execute('DROP TRIGGER IF EXISTS wa_live_lines_msg_upd');
    await c.execute("CREATE TRIGGER wa_live_lines_msg_upd AFTER UPDATE ON groups_messages BEGIN SELECT 1; END");
    const m394 = MIGRATIONS.find((m) => m.id === '394_wa_live_kinds')!;
    expect(await runMigrations(c, [m394])).toEqual(['394_wa_live_kinds']);
    // Dos veces seguidas tampoco rompe.
    await m394.up(c);
    const triggers = (await c.execute("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name = 'wa_live_lines_msg_upd'")).rows;
    expect(String(triggers[0].sql)).toContain("'msg'");
    const names = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")).rows.map((r) => String(r.name));
    for (const [n] of WA_LIVE_MESSAGE_TRIGGERS) expect(names).toContain(n);
    const idx = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_groups_messages_client', 'idx_inbox_messages_client', 'idx_groups_team_members_person')")).rows;
    expect(idx).toHaveLength(3);
    // Y va después de la 393 (las que vienen después se suman al final).
    expect(MIGRATIONS.findIndex((m) => m.id === '394_wa_live_kinds')).toBeGreaterThan(MIGRATIONS.findIndex((m) => m.id === '393_fewer_reads'));
  });
});

describe('ronda 4: ningún reintento manda dos veces', () => {
  it('Inbox, texto con menciones (sendWaMessage): el mismo clientId sale una vez y el reintento no da error', async () => {
    const { owner, account } = await inboxSetup('r4-mentions');
    const gid = '120363000000098501@g.us';
    await inboxHook(account, [message(gid, 'r4m-0', { isGroup: true, chatName: 'Equipo', senderPhone: '5491100098502' })]);
    const [t] = await listThreads(owner);
    session.user = { id: owner, email: 'r4@test.local', name: 'x', team: null, role: 'owner' };
    const { POST } = await import('@/lib/routes/inbox/threads/[id]/messages/route');
    const send = () =>
      POST(
        new Request(`http://zerosoft.test/api/inbox/threads/${t.id}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'hola @5491100098502', mentions: ['5491100098502'], clientId: 'cid-r4-mention' }),
        }),
        { params: Promise.resolve({ id: t.id }) },
      );
    const key = `inbox-${account.id}`;
    const before = fakeSent(key).length;
    expect((await send()).status).toBe(201);
    // Reintento (se perdió la respuesta), y otro más: 201 los dos, y a WhatsApp salió una vez.
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect(fakeSent(key).length).toBe(before + 1);
    const rows = (await getDb().prepare("SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ? AND client_id = 'cid-r4-mention'").get(t.id)) as { n: number };
    expect(Number(rows.n)).toBe(1);
  });

  it('Inbox: el insert de un mensaje con un clientId ya guardado no tira error (no responde 500)', async () => {
    const { owner, account } = await inboxSetup('r4-conflict');
    await inboxHook(account, [message('5491100098511@s.whatsapp.net', 'r4c-0')]);
    const [t] = await listThreads(owner);
    const { addMessage, getThreadRow } = await import('@/lib/inbox/core');
    const row = await getThreadRow(owner, t.id);
    expect(await addMessage(row, { externalId: 'ext-1', fromMe: true, body: 'uno', status: 'sent', clientId: 'cid-r4-conf' })).toBe(true);
    // Otro id de WhatsApp, el mismo clientId (el caso de dos envíos que se cruzaron): no entra y no falla.
    expect(await addMessage(row, { externalId: 'ext-2', fromMe: true, body: 'uno', status: 'sent', clientId: 'cid-r4-conf' })).toBe(false);
  });

  it('Inbox, archivo: el mismo clientId no lo manda dos veces', async () => {
    const { owner, account } = await inboxSetup('r4-media-inbox');
    await inboxHook(account, [message('5491100098521@s.whatsapp.net', 'r4i-0')]);
    const [t] = await listThreads(owner);
    const { sendWhatsappMedia } = await import('@/lib/inbox/wa-media');
    const key = `inbox-${account.id}`;
    const before = fakeSent(key).length;
    const file = { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimetype: 'image/png', filename: 'casa.png', size: 4, clientId: 'cid-r4-media1' };
    await sendWhatsappMedia(owner, t.id, file);
    await sendWhatsappMedia(owner, t.id, file);
    // Dos a la vez también.
    await Promise.all([sendWhatsappMedia(owner, t.id, { ...file, clientId: 'cid-r4-media2' }), sendWhatsappMedia(owner, t.id, { ...file, clientId: 'cid-r4-media2' })]);
    expect(fakeSent(key).length).toBe(before + 2);
  });

  it('Lines, archivo: la fila se reserva con el clientId antes de mandar; un reintento o uno a la vez no lo duplica', async () => {
    const { ws, number } = await linesSetup('r4-media-lines');
    await ingestEvents(number, [message('5491100098531@s.whatsapp.net', 'r4l-0')]);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    const { sendMessage } = await import('@/lib/groups');
    const media = { url: 'https://example.test/foto.png', mimetype: 'image/png', filename: 'foto.png' };
    const before = fakeSent(number.id).length;
    const a = await sendMessage(ws, ws, chat.id, { body: '', media, clientId: 'cid-r4-lmedia' });
    const b = await sendMessage(ws, ws, chat.id, { body: '', media, clientId: 'cid-r4-lmedia' });
    expect(b.id).toBe(a.id);
    expect(a.meta.cid).toBe('cid-r4-lmedia');
    expect(fakeSent(number.id).length).toBe(before + 1);
  });

  it('Lines, texto: dos pedidos con el mismo clientId a la vez salen una vez y los dos responden el mismo mensaje', async () => {
    const { ws, number } = await linesSetup('r4-concurrent');
    await ingestEvents(number, [message('5491100098541@s.whatsapp.net', 'r4k-0')]);
    await flush();
    const [chat] = (await listChats(ws, ws, {})).rows;
    session.user = { id: ws, email: 'r4k@test.local', name: 'x', team: null, role: 'owner' };
    const { POST } = await import('@/lib/routes/groups/chats/[id]/messages/route');
    // El proveedor tarda: el segundo pedido llega mientras el primero está saliendo.
    const fake = await import('@/lib/groups-provider-fake');
    const provider = fake.fakeProvider(number.id);
    const slow = { ...provider, sendText: async (c: string, t: string) => (await new Promise((r) => setTimeout(r, 80)), provider.sendText(c, t)) };
    vi.spyOn(fake, 'fakeProvider').mockImplementation(() => slow as typeof provider);
    const send = () =>
      POST(new Request(`http://zerosoft.test/api/groups/chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'a la vez', clientId: 'cid-r4-concur' }) }), {
        params: Promise.resolve({ id: chat.id }),
      });
    const before = fakeSent(number.id).length;
    const [r1, r2] = await Promise.all([send(), send()]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(((await r1.json()) as { id: string }).id).toBe(((await r2.json()) as { id: string }).id);
    expect(fakeSent(number.id).length).toBe(before + 1);
  });

  it('pasajero: la causa de red adentro de un TypeError cuenta; un valor demasiado grande, no', () => {
    const libsqlNet = new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
    expect(transientError(libsqlNet)).toBe(true);
    const deep = Object.assign(new Error('SERVER_ERROR'), { name: 'LibsqlError', cause: new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } }) });
    expect(transientError(deep)).toBe(true);
    expect(transientError(new TypeError('fetch failed'))).toBe(false);
    expect(transientError(Object.assign(new Error('SQLITE_TOOBIG: string or blob too big'), { name: 'LibsqlError', code: 'SQLITE_TOOBIG' }))).toBe(false);
    expect(transientError(Object.assign(new Error('SQLITE_RANGE: column index out of range'), { name: 'LibsqlError', code: 'SQLITE_RANGE' }))).toBe(false);
  });

  it('la consulta del aviso de Lines no lee quién mira si no hay avisos', async () => {
    const { ws } = await linesSetup('r4-lazy');
    session.user = { id: ws, email: 'r4l@test.local', name: 'x', team: null, role: 'owner' };
    const access = await import('@/lib/groups-access');
    const spy = vi.spyOn(access, 'getPlatformSettings');
    const { GET } = await import('@/app/api/groups/live/route');
    const first = (await (await GET(new Request('http://zerosoft.test/api/groups/live?cursor=0'))).json()) as { cursor: number };
    spy.mockClear();
    const res = await GET(new Request(`http://zerosoft.test/api/groups/live?cursor=${first.cursor || 1}`));
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});
