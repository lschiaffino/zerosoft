import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import {
  addMessage,
  applyThreadAction,
  claimScheduled,
  createAccount,
  createFolder,
  createScheduled,
  createSnippet,
  deleteFolder,
  getThread,
  inboxCounts,
  listFolders,
  listMessages,
  listThreads,
  readAccountConfig,
  updateFolder,
  upsertThread,
  writeAccountConfig,
} from '@/lib/inbox/core';
import { fireFollowUps, wakeSnoozed } from '@/lib/inbox/cron';
import { applyGmailThread, emailText, splitAddress, syncGmail } from '@/lib/inbox/gmail';
import { importPart, parseImport } from '@/lib/inbox/import';
import { sendDueScheduled } from '@/lib/inbox/send';
import { searchInbox } from '@/lib/inbox/search';
import { cleanShortcut, fillSnippet, normalizeWaJid, presetDate, ruleMatches, waPhoneOf } from '@/lib/inbox/types';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { resetFakeProvider, fakeSent } from '@/lib/groups-provider-fake';
import { stripQuoted } from '@/lib/inbox/ai';
import { makeUser } from './helpers';

/** Sesión de las rutas: la persona real puede estar actuando en el workspace de otra (actingUser). */
const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const threadsRoute = await import('@/app/api/inbox/threads/route');
const webhookRoute = await import('@/app/api/inbox/webhook/[id]/[secret]/route');

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  resetFakeProvider();
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function waAccount(owner: string) {
  const a = await createAccount(owner, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
  return { ...a, status: 'connected' as const };
}

describe('Inbox: funciones puras', () => {
  it('normaliza los ids de whatsapp-web.js a los de Evolution', () => {
    expect(normalizeWaJid('5491155550000@c.us')).toBe('5491155550000@s.whatsapp.net');
    expect(normalizeWaJid('123-456@g.us')).toBe('123-456@g.us');
    expect(waPhoneOf('5491155550000@s.whatsapp.net')).toBe('5491155550000');
    expect(waPhoneOf('123@lid')).toBe('');
  });

  it('las reglas de carpeta piden todo lo que dicen, sin tildes ni mayúsculas', () => {
    const t = { channel: 'whatsapp' as const, kind: 'group' as const, title: 'Fútbol de los jueves', handle: '' };
    expect(ruleMatches({ kind: 'group' }, t)).toBe(true);
    expect(ruleMatches({ kind: 'group', from: 'futbol' }, t)).toBe(true);
    expect(ruleMatches({ channel: 'gmail', kind: 'group' }, t)).toBe(false);
    expect(ruleMatches({}, t)).toBe(false);
    expect(ruleMatches(null, t)).toBe(false);
  });

  it('presets de posponer siempre en el futuro', () => {
    const now = new Date(2026, 10, 8, 22, 30); // domingo 22:30
    expect(presetDate('tonight', now).getTime()).toBeGreaterThan(now.getTime());
    expect(presetDate('tomorrow', now).getHours()).toBe(8);
    expect(presetDate('weekend', now).getDay()).toBe(6);
    expect(presetDate('nextWeek', now).getDay()).toBe(1);
    expect(presetDate('later', now).getTime() - now.getTime()).toBe(3 * 3600_000);
  });

  it('snippets: atajo limpio y variables de nombre', () => {
    expect(cleanShortcut(';Gracias Mil!')).toBe('graciasmil');
    expect(fillSnippet('Hola {primer_nombre}, soy yo. ({name})', 'Ana Pérez')).toBe('Hola Ana, soy yo. (Ana Pérez)');
  });

  it('correo: dirección, texto desde HTML y parte citada', () => {
    expect(splitAddress('"Ana Pérez" <ana@x.com>')).toEqual({ name: 'Ana Pérez', email: 'ana@x.com' });
    expect(emailText({ text: '', html: '<p>Hola<br>mundo</p><script>x</script>', snippet: '' })).toBe('Hola\nmundo');
    expect(stripQuoted('Dale\n\nEl lun, 3 nov 2026 escribió:\n> hola')).toBe('Dale');
  });
});

describe('Inbox: chats y mensajes', () => {
  it('un mensaje nuevo de la otra persona saca el chat de Hecho y de pospuesto, y cancela el recordatorio', async () => {
    const u = await makeUser('ib');
    const a = await waAccount(u.id);
    const t = await upsertThread(a, { externalId: '5491100000001@s.whatsapp.net', kind: 'dm', title: 'Ana', handle: '5491100000001' });
    expect(await addMessage(t, { externalId: 'm1', fromMe: true, body: 'Hola', sentAt: '2026-11-01T10:00:00Z' })).toBe(true);
    // Mismo id: no se duplica.
    expect(await addMessage(t, { externalId: 'm1', fromMe: true, body: 'Hola', sentAt: '2026-11-01T10:00:00Z' })).toBe(false);
    await applyThreadAction(u.id, [t.id], { action: 'done' });
    await applyThreadAction(u.id, [t.id], { action: 'followUp', at: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await getThread(u.id, t.id)).done).toBe(true);
    await addMessage(t, { externalId: 'm2', fromMe: false, body: 'Te respondo', senderName: 'Ana' });
    const after = await getThread(u.id, t.id);
    expect(after.done).toBe(false);
    expect(after.unread).toBe(1);
    expect(after.followUpAt).toBeNull();
    expect(after.preview).toBe('Te respondo');
    // Un mensaje viejo (historial) no cuenta como no leído ni mueve la vista previa.
    await addMessage(t, { externalId: 'm0', fromMe: false, body: 'viejo', sentAt: '2026-01-01T00:00:00Z', history: true });
    expect((await getThread(u.id, t.id)).unread).toBe(1);
    expect((await getThread(u.id, t.id)).preview).toBe('Te respondo');
    // Mandar algo propio deja el chat leído.
    await addMessage(t, { externalId: 'm3', fromMe: true, body: 'Gracias' });
    expect((await getThread(u.id, t.id)).unread).toBe(0);
    const page = await listMessages(u.id, t.id);
    expect(page.messages.map((m) => m.body)).toEqual(['viejo', 'Hola', 'Te respondo', 'Gracias']);
  });

  it('vistas: por responder, esperando, pospuestos, hechos y búsqueda en el texto', async () => {
    const u = await makeUser('ib');
    const a = await waAccount(u.id);
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const reply = await upsertThread(a, { externalId: '1@s.whatsapp.net', kind: 'dm', title: 'Por responder' });
    await addMessage(reply, { externalId: 'a', fromMe: false, body: '¿venís el sábado?' });
    const waiting = await upsertThread(a, { externalId: '2@s.whatsapp.net', kind: 'dm', title: 'Esperando' });
    await addMessage(waiting, { externalId: 'b', fromMe: true, body: 'Te mandé la propuesta', sentAt: old });
    const group = await upsertThread(a, { externalId: '3@g.us', kind: 'group', title: 'Grupo' });
    await addMessage(group, { externalId: 'c', fromMe: false, body: 'hola grupo' });
    const ids = (v: Parameters<typeof listThreads>[1]) => listThreads(u.id, v).then((r) => r.map((x) => x.title).sort());
    expect(await ids({ view: 'reply' })).toEqual(['Por responder']);
    expect(await ids({ view: 'waiting' })).toEqual(['Esperando']);
    expect(await ids({ view: 'groups' })).toEqual(['Grupo']);
    await applyThreadAction(u.id, [reply.id], { action: 'snooze', until: new Date(Date.now() + 3600_000).toISOString() });
    await applyThreadAction(u.id, [waiting.id], { action: 'done' });
    expect(await ids({ view: 'inbox' })).toEqual(['Grupo']);
    expect(await ids({ view: 'snoozed' })).toEqual(['Por responder']);
    expect(await ids({ view: 'done' })).toEqual(['Esperando']);
    // La búsqueda mira también Hechos y el texto de los mensajes.
    expect(await ids({ q: 'propuesta' })).toEqual(['Esperando']);
    expect((await inboxCounts(u.id)).snoozed).toBe(1);
    // No se puede posponer al pasado.
    await expect(applyThreadAction(u.id, [group.id], { action: 'snooze', until: new Date(Date.now() - 1000).toISOString() })).rejects.toMatchObject({ code: 'date_in_past' });
  });

  it('carpetas: a mano o por regla, sin ciclos, y borrar no borra chats', async () => {
    const u = await makeUser('ib');
    const a = await waAccount(u.id);
    const fam = await upsertThread(a, { externalId: '10@g.us', kind: 'group', title: 'Familia' });
    await addMessage(fam, { externalId: 'x', fromMe: false, body: 'hola' });
    const ana = await upsertThread(a, { externalId: '11@s.whatsapp.net', kind: 'dm', title: 'Ana' });
    await addMessage(ana, { externalId: 'y', fromMe: false, body: 'hola' });
    const groups = await createFolder(u.id, { name: 'Grupos', rule: { kind: 'group' } });
    const people = await createFolder(u.id, { name: 'Gente' });
    const child = await createFolder(u.id, { name: 'Sub', parentId: people.id });
    await applyThreadAction(u.id, [ana.id], { action: 'addFolder', folderId: people.id });
    expect((await listThreads(u.id, { folderId: groups.id })).map((t) => t.title)).toEqual(['Familia']);
    expect((await listThreads(u.id, { folderId: people.id })).map((t) => t.title)).toEqual(['Ana']);
    expect((await listFolders(u.id)).find((f) => f.id === people.id)?.count).toBe(1);
    await expect(updateFolder(u.id, people.id, { parentId: child.id })).rejects.toMatchObject({ code: 'invalid_parent' });
    await deleteFolder(u.id, people.id);
    expect((await listFolders(u.id)).find((f) => f.id === child.id)?.parentId).toBeNull();
    expect((await getThread(u.id, ana.id)).folderIds).toEqual([]);
  });
});

describe('Inbox: aislamiento', () => {
  it('nadie ve ni toca lo de otra persona, ni con los ids', async () => {
    const owner = await makeUser('ib-owner');
    const admin = await makeUser('ib-admin');
    const a = await waAccount(owner.id);
    const t = await upsertThread(a, { externalId: '20@s.whatsapp.net', kind: 'dm', title: 'Privado del dueño' });
    await addMessage(t, { externalId: 'p', fromMe: false, body: 'secreto' });
    await expect(getThread(admin.id, t.id)).rejects.toMatchObject({ status: 404 });
    await expect(listMessages(admin.id, t.id)).rejects.toMatchObject({ status: 404 });
    expect(await applyThreadAction(admin.id, [t.id], { action: 'done' })).toEqual([]);
    expect((await getThread(owner.id, t.id)).done).toBe(false);
    expect(await searchInbox(admin.id, 'Privado')).toEqual([]);
    const f = await createFolder(owner.id, { name: 'Mía' });
    await expect(applyThreadAction(admin.id, [t.id], { action: 'addFolder', folderId: f.id })).rejects.toMatchObject({ status: 404 });
    await expect(createScheduled(admin.id, t.id, 'hola', new Date(Date.now() + 3600_000).toISOString())).rejects.toMatchObject({ status: 404 });
  });

  it('la API usa la persona real: un admin dentro del workspace del dueño ve solo su propia bandeja', async () => {
    const owner = await makeUser('ib-owner');
    const admin = await makeUser('ib-admin');
    const a = await waAccount(owner.id);
    await upsertThread(a, { externalId: '21@s.whatsapp.net', kind: 'dm', title: 'Del dueño' });
    session.user = { ...owner, actingUser: admin, role: 'admin', apps: '*' };
    const res = await threadsRoute.GET(new Request('http://x/api/inbox/threads?view=inbox'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { threads: unknown[] }).threads).toEqual([]);
    session.user = { ...owner, role: 'owner', apps: '*' };
    const mine = (await (await threadsRoute.GET(new Request('http://x/api/inbox/threads?view=inbox'))).json()) as { threads: Array<{ title: string }> };
    expect(mine.threads.map((t) => t.title)).toEqual(['Del dueño']);
    session.user = null;
    expect((await threadsRoute.GET(new Request('http://x/api/inbox/threads'))).status).toBe(401);
  });

  it('los tokens de la cuenta quedan cifrados en la base', async () => {
    const u = await makeUser('ib');
    const a = await createAccount(u.id, { kind: 'gmail', provider: 'google', address: 'me@x.com' });
    await writeAccountConfig(a.id, { accessToken: 'ya29.secret-token', refreshToken: '1//refresh-secret', expiresAt: 0, scope: '' });
    const raw = (await getDb().prepare('SELECT config FROM inbox_accounts WHERE id = ?').get(a.id)) as { config: string };
    expect(raw.config).not.toContain('secret');
    expect(raw.config.startsWith('enc:v1:')).toBe(true);
    const row = (await getDb().prepare('SELECT * FROM inbox_accounts WHERE id = ?').get(a.id)) as { config: string };
    expect(readAccountConfig<{ refreshToken: string }>(row).refreshToken).toBe('1//refresh-secret');
  });
});

describe('Inbox: WhatsApp (proveedor falso)', () => {
  it('vincular muestra el QR y el webhook guarda mensajes, ediciones y borrados para todos (que se conservan)', async () => {
    const u = await makeUser('ib');
    const { account, state } = await connectWhatsapp(u.id);
    expect(account.provider).toBe('fake');
    expect(['qr', 'connected']).toContain(state.status);
    const events = [
      { type: 'message', chatId: '5491100000099@s.whatsapp.net', isGroup: false, fromMe: false, senderPhone: '5491100000099', senderName: 'Bruno', providerMessageId: 'w1', body: 'hola', timestamp: '2026-11-01T10:00:00.000Z' },
      { type: 'message', chatId: '5491100000099@s.whatsapp.net', isGroup: false, fromMe: false, senderPhone: '5491100000099', senderName: 'Bruno', providerMessageId: 'w2', body: 'me equivoqué', timestamp: '2026-11-01T10:01:00.000Z' },
      { type: 'edit', chatId: '5491100000099@s.whatsapp.net', providerMessageId: 'w1', body: 'hola!!' },
      { type: 'revoke', chatId: '5491100000099@s.whatsapp.net', providerMessageId: 'w2' },
    ];
    const bad = await webhookRoute.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ events }) }), { params: Promise.resolve({ id: account.id, secret: 'nope' }) });
    expect(bad.status).toBe(404);
    const ok = await webhookRoute.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ events }) }), { params: Promise.resolve({ id: account.id, secret: account.webhook_secret }) });
    expect(ok.status).toBe(200);
    const [t] = await listThreads(u.id, { view: 'inbox' });
    expect(t.title).toBe('Bruno');
    expect(t.handle).toBe('5491100000099');
    const msgs = (await listMessages(u.id, t.id)).messages;
    expect(msgs.map((m) => [m.body, m.edited, m.revoked])).toEqual([
      ['hola!!', true, false],
      ['me equivoqué', false, true],
    ]);
  });

  it('un programado se manda una sola vez aunque dos corridas lo reclamen', async () => {
    const u = await makeUser('ib');
    const { account } = await connectWhatsapp(u.id);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    // El proveedor falso tarda 1,5 s en "escanear".
    await new Promise((r) => setTimeout(r, 1600));
    const t = await upsertThread({ ...account, kind: 'whatsapp' }, { externalId: '5491100000077@s.whatsapp.net', kind: 'dm', title: 'Caro' });
    const s = await createScheduled(u.id, t.id, 'Feliz cumple!', new Date(Date.now() + 60_000).toISOString());
    const later = new Date(Date.now() + 120_000);
    const [a, b] = await Promise.all([claimScheduled(s.id, later), claimScheduled(s.id, later)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    await getDb().prepare("UPDATE inbox_scheduled SET status = 'pending', claimed_until = NULL WHERE id = ?").run(s.id);
    const r = await sendDueScheduled(later);
    expect(r.sent).toBe(1);
    expect(fakeSent(`inbox-${account.id}`).map((x) => x.text)).toEqual(['Feliz cumple!']);
    expect((await sendDueScheduled(later)).sent).toBe(0);
    expect((await listMessages(u.id, t.id)).messages.at(-1)?.body).toBe('Feliz cumple!');
  });
});

describe('Inbox: cron', () => {
  it('lo pospuesto vuelve marcado y el recordatorio solo salta si no contestaron', async () => {
    const u = await makeUser('ib');
    const a = await waAccount(u.id);
    const s = await upsertThread(a, { externalId: '30@s.whatsapp.net', kind: 'dm', title: 'Pospuesto' });
    const f1 = await upsertThread(a, { externalId: '31@s.whatsapp.net', kind: 'dm', title: 'Sin respuesta' });
    const f2 = await upsertThread(a, { externalId: '32@s.whatsapp.net', kind: 'dm', title: 'Contestó' });
    const soon = new Date(Date.now() + 60_000).toISOString();
    await applyThreadAction(u.id, [s.id], { action: 'snooze', until: soon });
    await applyThreadAction(u.id, [f1.id, f2.id], { action: 'followUp', at: soon });
    await applyThreadAction(u.id, [f1.id, f2.id], { action: 'done' });
    // f2 contestó (por la base, sin pasar por addMessage, para probar el cron solo).
    await getDb().prepare('UPDATE inbox_threads SET last_inbound_at = ? WHERE id = ?').run(new Date(Date.now() + 1000).toISOString(), f2.id);
    const later = new Date(Date.now() + 120_000);
    expect(await wakeSnoozed(later)).toBe(1);
    expect(await fireFollowUps(later)).toBe(1);
    expect((await getThread(u.id, s.id)).woke).toBe('snooze');
    const back = await getThread(u.id, f1.id);
    expect([back.woke, back.done]).toEqual(['followup', false]);
    const replied = await getThread(u.id, f2.id);
    expect([replied.woke, replied.done, replied.followUpAt]).toEqual(['', true, null]);
  });
});

describe('Inbox: Gmail', () => {
  const parsed = (id: string, labels: string[], from: string, to: string, at: string) => ({
    id, threadId: 't1', labelIds: labels, subject: 'Contrato', from, to, cc: '', messageId: `<${id}@x>`, inReplyTo: '', references: '', snippet: '', text: `cuerpo ${id}`, html: '', internalDate: at,
  });

  it('un hilo de Gmail: nombre de la otra persona, leído y bandeja según las etiquetas', async () => {
    const u = await makeUser('ib');
    const a = await createAccount(u.id, { kind: 'gmail', provider: 'google', address: 'me@x.com' });
    const t = await applyGmailThread(a, 't1', [
      parsed('g1', ['INBOX'], 'Ana <ana@y.com>', 'me@x.com', '2026-11-01T10:00:00.000Z'),
      parsed('g2', ['SENT'], 'Me <me@x.com>', 'ana@y.com', '2026-11-01T11:00:00.000Z'),
      parsed('g3', ['INBOX', 'UNREAD'], 'Ana <ana@y.com>', 'me@x.com', '2026-11-02T10:00:00.000Z'),
    ]);
    const dto = await getThread(u.id, t!.id);
    expect([dto.title, dto.handle, dto.unread, dto.done, dto.channel]).toEqual(['Ana', 'ana@y.com', 1, false, 'gmail']);
    expect(dto.preview).toContain('Contrato');
    // Archivado en Gmail: queda en Hecho.
    await applyGmailThread(a, 't1', [parsed('g1', [], 'Ana <ana@y.com>', 'me@x.com', '2026-11-01T10:00:00.000Z')]);
    expect((await getThread(u.id, t!.id)).done).toBe(true);
  });

  it('sync: carga inicial y después solo los cambios (fetch simulado, el token se refresca)', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    const u = await makeUser('ib');
    const a = await createAccount(u.id, { kind: 'gmail', provider: 'google', address: 'me@x.com' });
    await writeAccountConfig(a.id, { accessToken: 'old', refreshToken: 'r1', expiresAt: 0, scope: '' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
    const calls: string[] = [];
    const msg = (id: string, labels: string[]) => ({
      id, threadId: 'th1', labelIds: labels, internalDate: String(Date.parse(id === 'm1' ? '2026-11-05T10:00:00Z' : '2026-11-05T10:05:00Z')),
      payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Bob <bob@z.com>' }, { name: 'To', value: 'me@x.com' }, { name: 'Subject', value: 'Hola' }], body: { data: Buffer.from(`texto ${id}`).toString('base64url') } },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url.replace('https://gmail.googleapis.com/gmail/v1/users/me', ''));
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'fresh', expires_in: 3600 });
      if (url.endsWith('/profile')) return json({ historyId: '100', emailAddress: 'me@x.com' });
      if (url.includes('/threads?')) return json({ threads: [{ id: 'th1' }] });
      if (url.includes('/threads/th1')) return json({ id: 'th1', messages: calls.some((c) => c.startsWith('/history')) ? [msg('m1', ['INBOX']), msg('m2', ['INBOX', 'UNREAD'])] : [msg('m1', ['INBOX'])] });
      if (url.includes('/history?')) return json({ historyId: '120', history: [{ messages: [{ threadId: 'th1' }] }] });
      return new Response('{}', { status: 404 });
    }));
    const row = async () => (await getDb().prepare('SELECT * FROM inbox_accounts WHERE id = ?').get(a.id)) as Parameters<typeof syncGmail>[0];
    expect(await syncGmail(await row())).toBe(1);
    expect((await row()).sync_cursor).toBe('100');
    expect(await syncGmail(await row())).toBe(1);
    expect((await row()).sync_cursor).toBe('120');
    const [t] = await listThreads(u.id, { view: 'email' });
    expect(t.unread).toBe(1);
    expect((await listMessages(u.id, t.id)).messages.map((m) => m.body)).toEqual(['texto m1', 'texto m2']);
    expect(readAccountConfig<{ accessToken: string }>(await row()).accessToken).toBe('fresh');
  });
});

describe('Inbox: importar desde inbox-zero', () => {
  it('el script exporta inbox.db y la importación es idempotente', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'zs-inbox-zero-'));
    const schema = `
      CREATE TABLE wa_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT '#00a884', position INTEGER NOT NULL DEFAULT 0, icon TEXT NOT NULL DEFAULT '', parent_id INTEGER);
      CREATE TABLE wa_chat_tags (chat_id TEXT NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (chat_id, tag_id));
      CREATE TABLE wa_scheduled (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, chat_name TEXT, text TEXT NOT NULL, send_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, sent_at INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE wa_drafts (chat_id TEXT PRIMARY KEY, chat_name TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'user', updated_at INTEGER NOT NULL);
      CREATE TABLE wa_snooze (chat_id TEXT PRIMARY KEY, until INTEGER NOT NULL, mirror INTEGER NOT NULL DEFAULT 0, woke INTEGER NOT NULL DEFAULT 0, set_at INTEGER NOT NULL);
      CREATE TABLE wa_memories (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE wa_saved (msg_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, ts INTEGER NOT NULL, from_me INTEGER NOT NULL, sender TEXT, type TEXT, text TEXT, mime TEXT, fname TEXT, saved_at INTEGER NOT NULL);
      CREATE TABLE mail_accounts (email TEXT PRIMARY KEY, pass TEXT NOT NULL, label TEXT NOT NULL, color TEXT, pos INTEGER DEFAULT 0, created INTEGER NOT NULL);
    `;
    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const rows = `
      INSERT INTO wa_tags (id, name, color, position, parent_id) VALUES (1, 'Familia', '#3b82f6', 0, NULL), (2, 'Primos', '#ef4444', 1, 1);
      INSERT INTO wa_chat_tags VALUES ('5491100000001@c.us', 1), ('120363@g.us', 2);
      INSERT INTO wa_scheduled (chat_id, chat_name, text, send_at, status, created_at) VALUES ('5491100000001@c.us', 'Mamá', 'Feliz día\u001eTe quiero', ${now + 86_400_000}, 'pending', ${now}), ('5491100000001@c.us', 'Mamá', 'viejo', ${now - 1000}, 'sent', ${now});
      INSERT INTO wa_drafts VALUES ('120363@g.us', 'Primos', 'borrador del grupo', 'user', ${now});
      INSERT INTO wa_snooze VALUES ('5491100000002@c.us', ${now + 3_600_000}, 0, 0, ${now});
      INSERT INTO wa_memories (chat_id, text, created_at) VALUES ('5491100000001@c.us', 'Le gusta el té', ${now});
      INSERT INTO wa_saved VALUES ('false_5491100000001@c.us_AAA', '5491100000001@c.us', ${sec - 60}, 0, 'Mamá', 'chat', 'Hola hijo', NULL, NULL, ${now});
      INSERT INTO mail_accounts VALUES ('me@gmail.com', 'app-password-secret', 'Me', NULL, 0, ${now});
    `;
    // La base de inbox-zero se arma con node:sqlite en otro proceso (como la tendría el dueño en su computadora).
    const setup = `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec(process.argv[2]); db.exec(process.argv[3]); db.close();`;
    execFileSync(process.execPath, ['--input-type=module', '-e', setup, path.join(dir, 'inbox.db'), schema, rows], { stdio: 'pipe' });
    const out = path.join(dir, 'export.json');
    execFileSync(process.execPath, [path.resolve('scripts/inbox-zero-export.mjs'), dir, '--out', out], { stdio: 'pipe' });
    const raw = readFileSync(out, 'utf8');
    expect(raw).not.toContain('app-password-secret');
    const file = JSON.parse(raw) as Record<string, unknown[]> & { format: string; version: number };
    expect(file.format).toBe('inbox-zero-export');
    expect(file.scheduled).toHaveLength(1);

    const u = await makeUser('ib');
    const { messages, ...meta } = file;
    const run = async () => {
      const r1 = await importPart(u.id, parseImport({ part: 'meta', ...meta }));
      const r2 = await importPart(u.id, parseImport({ part: 'messages', messages }));
      return { ...r1, messages: r2.messages };
    };
    const first = await run();
    expect(first).toMatchObject({ folders: 2, scheduled: 1, drafts: 1, snoozes: 1, notes: 1, messages: 1 });
    const second = await run();
    expect(second).toMatchObject({ folders: 0, scheduled: 0, drafts: 0, notes: 0, messages: 0 });

    const folders = await listFolders(u.id);
    const fam = folders.find((f) => f.name === 'Familia')!;
    expect(folders.find((f) => f.name === 'Primos')?.parentId).toBe(fam.id);
    const mom = (await listThreads(u.id, { folderId: fam.id }))[0];
    expect(mom.title).toBe('Mamá');
    expect(mom.handle).toBe('5491100000001');
    const detail = await getDb().prepare('SELECT external_id, notes FROM inbox_threads WHERE id = ?').get(mom.id) as { external_id: string; notes: string };
    expect(detail.external_id).toBe('5491100000001@s.whatsapp.net');
    expect(detail.notes).toBe('Le gusta el té');
    const sched = await getDb().prepare("SELECT body FROM inbox_scheduled WHERE owner_id = ? AND status = 'pending'").all(u.id) as Array<{ body: string }>;
    // Los programados de varios mensajes llegan como una secuencia: cada uno su burbuja.
    expect(sched.map((s) => s.body)).toEqual(['Feliz día', 'Te quiero']);
    expect((await listThreads(u.id, { view: 'snoozed' })).length).toBe(1);
    expect((await listMessages(u.id, mom.id)).messages.map((m) => m.body)).toEqual(['Hola hijo']);
  });

  it('rechaza un archivo que no es una exportación', () => {
    expect(() => parseImport({ part: 'meta', format: 'otra-cosa', version: 1 })).toThrow();
    expect(() => parseImport({ part: 'messages', messages: Array.from({ length: 1001 }, () => ({ id: 'x', chatId: 'a@c.us', ts: 1, fromMe: true })) })).toThrow();
  });
});

describe('Inbox: snippets y programados', () => {
  it('snippet sin cuerpo no se crea; programado al pasado tampoco', async () => {
    const u = await makeUser('ib');
    await expect(createSnippet(u.id, { title: 'x', body: '  ' })).rejects.toMatchObject({ code: 'invalid_input' });
    const s = await createSnippet(u.id, { title: 'Gracias', body: 'Gracias {nombre}!', shortcut: ';Gracias' });
    expect(s.shortcut).toBe('gracias');
    const a = await waAccount(u.id);
    const t = await upsertThread(a, { externalId: '40@s.whatsapp.net', kind: 'dm', title: 'X' });
    await expect(createScheduled(u.id, t.id, 'hola', new Date(Date.now() - 60_000).toISOString())).rejects.toMatchObject({ code: 'date_in_past' });
  });

  it('el evento de sesión del proveedor actualiza el estado sin pisar otras cuentas', async () => {
    const u = await makeUser('ib');
    const a = await waAccount(u.id);
    await ingestWhatsappEvents(a, [{ type: 'session', status: 'disconnected' }]);
    const row = (await getDb().prepare('SELECT status FROM inbox_accounts WHERE id = ?').get(a.id)) as { status: string };
    expect(row.status).toBe('disconnected');
  });
});
