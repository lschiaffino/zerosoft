/**
 * Inbox: "Sacar de Inbox" ya no borra el chat. Queda en "Sacados de Inbox"
 * (fuera de todo lo demás), se recupera a donde estaba, sigue guardando lo que
 * llega, no vuelve por volver a importar ni por juntar lid y teléfono, se
 * borra del todo a pedido o a los 30 días y nadie más lo ve.
 * Números, lids y textos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { applyThreadAction, createAccount, createFolder, findThread, getAccountById, getThread, inboxCounts, listMessages, listThreads, saveNotes } from '@/lib/inbox/core';
import { ingestHistoryChats, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { listRemoved, purgeExpiredRemoved, purgeThreads, removeThreads, restoreThreads, REMOVED_RETENTION_DAYS } from '@/lib/inbox/removed';
import { searchInbox } from '@/lib/inbox/search';
import { searchMessages } from '@/lib/inbox/message-search';
import { listFolders } from '@/lib/inbox/core';
import { rememberContacts } from '@/lib/wa-contacts';
import { mergeLidChats } from '@/lib/wa-dedupe-run';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, countHiddenChats, createNumber, getNumberRowById, ingestEvents, listChats, updateChat } from '@/lib/groups';
import type { InboundEvent } from '@/lib/groups-provider';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null, delegated: false }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
vi.mock('@/lib/mcp/identity', async (orig) => ({
  ...((await orig()) as object),
  delegatedIdentity: () => (session.delegated ? { kind: 'api_key', userId: session.user?.id ?? '' } : undefined),
}));

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  session.user = null;
  session.delegated = false;
});
afterEach(() => vi.unstubAllEnvs());

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
function person() {
  const n = Math.floor(10_000_000 + Math.random() * 89_999_999);
  return { phone: `10${n}`, lid: `7${n}${Math.floor(100_000 + Math.random() * 899_999)}` };
}

function msg(chatId: string, over: Partial<Extract<InboundEvent, { type: 'message' }>> = {}): InboundEvent {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.endsWith('@s.whatsapp.net') ? chatId.replace(/@.*/, '') : '',
    senderName: 'Contacto Prueba',
    providerMessageId: `m-${uniq()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  } as InboundEvent;
}

async function account(label: string, owner?: string) {
  const id = owner ?? (await makeUser(label)).id;
  const a = await createAccount(id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
  return { owner: id, acc: (await getAccountById(a.id))! };
}

/** Un chat de WhatsApp con un mensaje, y su id. */
async function chat(acc: Awaited<ReturnType<typeof account>>['acc'], body = 'hola') {
  const p = person();
  const jid = `${p.phone}@s.whatsapp.net`;
  await ingestWhatsappEvents(acc, [msg(jid, { body })]);
  return { id: (await findThread(acc.id, jid))!.id, jid, p };
}

const ids = (list: Array<{ id: string }>) => list.map((t) => t.id).sort();

describe('Sacar de Inbox y recuperar', () => {
  it('sacado: fuera de vistas, carpetas, contadores, búsqueda y lectura; aparece en Sacados con fechas', async () => {
    const { owner, acc } = await account('rm-a');
    const a = await chat(acc, 'texto-sacado-zq1');
    const b = await chat(acc, 'otro texto');
    const folder = await createFolder(owner, { name: `F ${uniq()}` });
    await applyThreadAction(owner, [a.id, b.id], { action: 'addFolder', folderId: folder.id });
    const before = await inboxCounts(owner);
    const now = new Date();
    expect(await removeThreads(owner, [a.id], now)).toEqual([a.id]);
    // Sacar dos veces no cambia la fecha.
    expect(await removeThreads(owner, [a.id])).toEqual([]);

    for (const view of ['inbox', 'unread', 'reply', 'whatsapp', 'archived'] as const) expect(ids(await listThreads(owner, { view }))).not.toContain(a.id);
    expect(ids(await listThreads(owner, { folderId: folder.id }))).toEqual([b.id]);
    expect(ids(await listThreads(owner, { q: 'texto-sacado-zq1' }))).toEqual([]);
    const counts = await inboxCounts(owner);
    expect(counts.inbox).toBe(before.inbox - 1);
    expect(counts.removed).toBe(1);
    const unreadInFolder = (await listFolders(owner)).find((f) => f.id === folder.id);
    expect(unreadInFolder?.count).toBe(1);
    await expect(getThread(owner, a.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(listMessages(owner, a.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await searchMessages(owner, 'texto-sacado-zq1')).hits).toHaveLength(0);
    expect((await searchInbox(owner, 'Contacto Prueba')).map((h) => h.id)).not.toContain(a.id);
    // Las acciones de la lista no lo tocan.
    expect(await applyThreadAction(owner, [a.id], { action: 'pin' })).toEqual([]);

    const removed = await listRemoved(owner);
    expect(removed.map((t) => t.id)).toEqual([a.id]);
    expect(removed[0].removedAt).toBe(now.toISOString());
    expect(Date.parse(removed[0].purgeAt!) - now.getTime()).toBe(REMOVED_RETENTION_DAYS * 86_400_000);
    expect((await listThreads(owner, { view: 'removed' })).map((t) => t.id)).toEqual([a.id]);
  });

  it('recuperar lo devuelve a donde estaba: carpeta, archivado y fijado', async () => {
    const { owner, acc } = await account('rm-b');
    const pinned = await chat(acc);
    const archived = await chat(acc);
    const folder = await createFolder(owner, { name: `F ${uniq()}` });
    await applyThreadAction(owner, [pinned.id], { action: 'pin' });
    await applyThreadAction(owner, [pinned.id, archived.id], { action: 'addFolder', folderId: folder.id });
    await applyThreadAction(owner, [archived.id], { action: 'archive' });
    await saveNotes(owner, pinned.id, 'nota');
    await removeThreads(owner, [pinned.id, archived.id]);
    expect(await restoreThreads(owner, [pinned.id, archived.id])).toHaveLength(2);
    const p = await getThread(owner, pinned.id);
    expect(p).toMatchObject({ pinned: true, archived: false, folderIds: [folder.id] });
    const a = await getThread(owner, archived.id);
    expect(a).toMatchObject({ archived: true, folderIds: [folder.id] });
    expect(ids(await listThreads(owner, { view: 'archived' }))).toContain(archived.id);
    expect(ids(await listThreads(owner))).toContain(pinned.id);
    expect((await inboxCounts(owner)).removed).toBe(0);
    expect(await listRemoved(owner)).toEqual([]);
  });

  it('lo que llega mientras está sacado se guarda sin sacarlo ni moverlo; al recuperar está todo', async () => {
    const { owner, acc } = await account('rm-c');
    const a = await chat(acc, 'uno');
    await applyThreadAction(owner, [a.id], { action: 'archive' });
    await removeThreads(owner, [a.id]);
    const later = new Date(Date.now() + 5000).toISOString();
    await ingestWhatsappEvents(acc, [msg(a.jid, { body: 'dos', timestamp: later })]);
    expect(ids(await listThreads(owner))).not.toContain(a.id);
    expect((await inboxCounts(owner)).removed).toBe(1);
    const row = (await getDb().prepare('SELECT removed_at, archived_at, unread FROM inbox_threads WHERE id = ?').get(a.id)) as {
      removed_at: string | null;
      archived_at: string | null;
      unread: number;
    };
    expect(row.removed_at).not.toBeNull();
    // Un chat archivado vuelve a la bandeja con un mensaje nuevo; uno sacado se queda donde estaba.
    expect(row.archived_at).not.toBeNull();
    expect(Number(row.unread)).toBeGreaterThan(0);
    await restoreThreads(owner, [a.id]);
    expect((await listMessages(owner, a.id)).messages.map((m) => m.body)).toEqual(['uno', 'dos']);
  });

  it('volver a importar (historial, lista de chats) no lo trae de vuelta ni lo duplica', async () => {
    const { owner, acc } = await account('rm-d');
    const first = msg(`${person().phone}@s.whatsapp.net`, { body: 'uno' });
    await ingestWhatsappEvents(acc, [first]);
    const jid = (first as { chatId: string }).chatId;
    const id = (await findThread(acc.id, jid))!.id;
    await removeThreads(owner, [id]);
    await ingestWhatsappEvents(
      acc,
      [{ ...(first as object), history: true } as InboundEvent, msg(jid, { body: 'viejo', history: true, timestamp: new Date(Date.now() - 86_400_000).toISOString() })],
      { history: true },
    );
    await ingestHistoryChats(acc, [{ remoteJid: jid, name: 'Contacto Prueba', archived: false, unreadCount: 3 }]);
    const rows = (await getDb().prepare('SELECT id, removed_at FROM inbox_threads WHERE account_id = ? AND external_id = ?').all(acc.id, jid)) as Array<{
      id: string;
      removed_at: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].removed_at).not.toBeNull();
    expect(ids(await listThreads(owner))).not.toContain(id);
  });

  it('juntar el chat por lid con el del teléfono no lo trae de vuelta', async () => {
    const { owner, acc } = await account('rm-e');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    await ingestWhatsappEvents(acc, [msg(pn, { body: 'por teléfono' })]);
    const phoneThread = (await findThread(acc.id, pn))!.id;
    await removeThreads(owner, [phoneThread]);
    // Llega algo solo por lid (sin par conocido): nace otro chat; al saberse el par, se juntan y siguen afuera.
    await ingestWhatsappEvents(acc, [msg(`${p.lid}@lid`, { senderLid: p.lid, chatLid: p.lid, body: 'por lid' })]);
    await rememberContacts({ app: 'inbox', accountId: acc.id, userId: owner }, [{ lid: p.lid, phone: p.phone }]);
    await mergeLidChats('inbox', acc.id, { all: true });
    const rows = (await getDb().prepare("SELECT id, removed_at FROM inbox_threads WHERE account_id = ? AND kind = 'dm'").all(acc.id)) as Array<{
      id: string;
      removed_at: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].removed_at).not.toBeNull();
    expect(ids(await listThreads(owner))).toEqual([]);
    await restoreThreads(owner, [rows[0].id]);
    expect((await listMessages(owner, rows[0].id)).messages.map((m) => m.body).sort()).toEqual(['por lid', 'por teléfono']);
  });
});

describe('Juntar chats', () => {
  it('si el sacado es el chat por lid (el que se borra al juntar), el que queda sigue afuera', async () => {
    const { owner, acc } = await account('rm-e2');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    await ingestWhatsappEvents(acc, [msg(`${p.lid}@lid`, { senderLid: p.lid, chatLid: p.lid, body: 'por lid' })]);
    const lidThread = (await findThread(acc.id, `${p.lid}@lid`))!.id;
    await removeThreads(owner, [lidThread]);
    await ingestWhatsappEvents(acc, [msg(pn, { body: 'por teléfono' })]);
    await rememberContacts({ app: 'inbox', accountId: acc.id, userId: owner }, [{ lid: p.lid, phone: p.phone }]);
    await mergeLidChats('inbox', acc.id, { all: true });
    const rows = (await getDb().prepare("SELECT id, external_id, removed_at FROM inbox_threads WHERE account_id = ? AND kind = 'dm'").all(acc.id)) as Array<{
      id: string;
      external_id: string;
      removed_at: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].removed_at).not.toBeNull();
    expect(ids(await listThreads(owner))).toEqual([]);
  });
});

describe('Borrar del todo', () => {
  it('a pedido: solo un chat ya sacado, con sus mensajes', async () => {
    const { owner, acc } = await account('rm-f');
    const a = await chat(acc);
    const b = await chat(acc);
    expect(await purgeThreads(owner, [a.id])).toEqual([]);
    await removeThreads(owner, [a.id]);
    expect(await purgeThreads(owner, [a.id, b.id])).toEqual([a.id]);
    expect(await getDb().prepare('SELECT 1 FROM inbox_threads WHERE id = ?').get(a.id)).toBeUndefined();
    expect(await getDb().prepare('SELECT 1 FROM inbox_messages WHERE thread_id = ?').get(a.id)).toBeUndefined();
    expect(ids(await listThreads(owner))).toEqual([b.id]);
  });

  it(`el cron borra los sacados hace más de ${REMOVED_RETENTION_DAYS} días y deja los nuevos`, async () => {
    const { owner, acc } = await account('rm-g');
    const old = await chat(acc);
    const fresh = await chat(acc);
    const now = new Date();
    await removeThreads(owner, [old.id], new Date(now.getTime() - (REMOVED_RETENTION_DAYS + 1) * 86_400_000));
    await removeThreads(owner, [fresh.id], new Date(now.getTime() - (REMOVED_RETENTION_DAYS - 1) * 86_400_000));
    expect(await purgeExpiredRemoved(now)).toBeGreaterThanOrEqual(1);
    expect(await getDb().prepare('SELECT 1 FROM inbox_threads WHERE id = ?').get(old.id)).toBeUndefined();
    expect((await listRemoved(owner)).map((t) => t.id)).toEqual([fresh.id]);
    // Otra corrida a la vez no hace nada dos veces.
    await purgeExpiredRemoved(now);
    expect((await listRemoved(owner)).map((t) => t.id)).toEqual([fresh.id]);
  });
});

describe('Privacidad', () => {
  it('nadie más ve, recupera ni borra los sacados de otra persona', async () => {
    const { owner, acc } = await account('rm-h');
    const a = await chat(acc);
    const other = await makeUser('rm-h-other');
    await removeThreads(owner, [a.id]);
    expect(await listRemoved(other.id)).toEqual([]);
    expect(await restoreThreads(other.id, [a.id])).toEqual([]);
    expect(await purgeThreads(other.id, [a.id])).toEqual([]);
    expect(await removeThreads(other.id, [a.id])).toEqual([]);
    expect((await listRemoved(owner)).map((t) => t.id)).toEqual([a.id]);
  });

  it('rutas: un compañero del equipo y una API key no llegan; el dueño sí', async () => {
    const w = await workspaceWithMember('rm-route');
    const { acc } = await account('rm-route', w.owner.id);
    const a = await chat(acc);
    const list = await import('@/app/api/inbox/threads/route');
    const one = await import('@/lib/routes/inbox/threads/[id]/route');
    const ctx = { params: Promise.resolve({ id: a.id }) };
    const post = (body: unknown) => list.POST(new Request('http://x/api/inbox/threads', { method: 'POST', body: JSON.stringify(body) }));

    session.user = asOwner(w.owner);
    expect((await one.DELETE(new Request(`http://x/api/inbox/threads/${a.id}`, { method: 'DELETE' }), ctx)).status).toBe(200);
    expect((await one.GET(new Request(`http://x/api/inbox/threads/${a.id}`), ctx)).status).toBe(404);

    // Compañero del equipo (en el workspace del dueño): no ve ni toca el chat sacado.
    session.user = asMember(w.owner, w.member);
    const seen = (await (await list.GET(new Request('http://x/api/inbox/threads?view=removed'))).json()) as { threads: Array<{ id: string }> };
    expect(seen.threads.map((t) => t.id)).not.toContain(a.id);
    expect(((await (await post({ ids: [a.id], action: 'restore' })).json()) as { changed: string[] }).changed).toEqual([]);
    expect((await one.DELETE(new Request(`http://x/api/inbox/threads/${a.id}?purge=1`, { method: 'DELETE' }), ctx)).status).toBe(404);

    // Con API key (o un agente): Inbox no responde.
    session.user = asOwner(w.owner);
    session.delegated = true;
    expect((await list.GET(new Request('http://x/api/inbox/threads?view=removed'))).status).toBe(401);
    expect((await post({ ids: [a.id], action: 'restore' })).status).toBe(401);
    session.delegated = false;

    const mine = (await (await list.GET(new Request('http://x/api/inbox/threads?view=removed'))).json()) as { threads: Array<{ id: string; removedAt: string }> };
    expect(mine.threads.map((t) => t.id)).toEqual([a.id]);
    expect(((await (await post({ ids: [a.id], action: 'restore' })).json()) as { changed: string[] }).changed).toEqual([a.id]);
    expect((await one.GET(new Request(`http://x/api/inbox/threads/${a.id}`), ctx)).status).toBe(200);
    // Borrar del todo un chat que no está sacado: no.
    expect((await one.DELETE(new Request(`http://x/api/inbox/threads/${a.id}?purge=1`, { method: 'DELETE' }), ctx)).status).toBe(404);
  });
});

describe('Lines: Eliminados', () => {
  it('"Eliminar chat" lo deja en Eliminados (solo los que tienen historial) y recuperarlo lo devuelve a la lista', async () => {
    const user = await makeUser('rm-lines');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
    const row = (await getNumberRowById(n.id))!;
    const a = `${person().phone}@s.whatsapp.net`;
    await ingestEvents(row, [msg(a, { body: 'uno' })]);
    const chatId = ((await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(n.id, a)) as { id: string }).id;
    // Un chat nuevo que nace oculto y sin mensajes (chat nuevo sin enviar) no es un eliminado.
    await getDb()
      .prepare(
        "INSERT INTO groups_chats (id, user_id, number_id, provider_chat_id, kind, name, phone, hidden_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'dm', '', '', ?, ?, ?)",
      )
      .run(`gc_${uniq()}`, user.id, n.id, `${person().phone}@s.whatsapp.net`, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    await updateChat(user.id, chatId, { hidden: true });
    expect((await listChats(user.id, user.id)).rows.map((c) => c.id)).not.toContain(chatId);
    const hidden = await listChats(user.id, user.id, { hidden: true });
    expect(hidden.rows.map((c) => c.id)).toEqual([chatId]);
    expect(hidden.rows[0].hiddenAt).toBeTruthy();
    expect(await countHiddenChats(user.id)).toBe(1);
    // Otro workspace no los ve.
    const other = await makeUser('rm-lines-other');
    expect((await listChats(other.id, other.id, { hidden: true })).rows).toEqual([]);
    await updateChat(user.id, chatId, { hidden: false });
    expect((await listChats(user.id, user.id)).rows.map((c) => c.id)).toContain(chatId);
    expect(await countHiddenChats(user.id)).toBe(0);
  });
});
