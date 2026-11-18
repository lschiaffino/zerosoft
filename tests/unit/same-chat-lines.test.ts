/**
 * El mismo chat en varias líneas (Lines) o cuentas de WhatsApp (Inbox): la
 * bandeja lo lista una vez con los no leídos sumados, el hilo junta los
 * mensajes de todas sin repetidos y cada mensaje dice por qué línea entró.
 * Teléfonos, ids y textos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, getChatRow } from '@/lib/groups';
import { groupsViewer } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { sameChatIds, withSameChatIds } from '@/lib/groups-same-chat';
import { collapseSameChats, dedupeLineMessages, defaultReplyLine, sameChatKey, waKeyId } from '@/lib/same-chat';
import { applyThreadAction, createAccount, findThread, getAccountById, listMessages as listInboxMessages, listThreads, listThreadsPage } from '@/lib/inbox/core';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { withInboxSameChatIds } from '@/lib/inbox/same-chat';
import type { InboundEvent } from '@/lib/groups-provider';
import { addMember } from '@/lib/teams';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const phone = () => `10${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const at = (min: number) => new Date(Date.UTC(2026, 10, 18, 10, min)).toISOString();

function ev(chatId: string, over: Partial<Extract<InboundEvent, { type: 'message' }>> = {}): InboundEvent {
  const group = chatId.endsWith('@g.us');
  return {
    type: 'message',
    chatId,
    isGroup: group,
    fromMe: false,
    senderPhone: group ? '5491100009999' : chatId.split('@')[0],
    senderName: 'Contacto Demo',
    providerMessageId: `m-${uniq()}`,
    body: 'hola',
    ...over,
  } as InboundEvent;
}

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

describe('lo puro', () => {
  it('clave, una fila por clave, sin repetidos y la línea para responder', () => {
    expect(sameChatKey('group', '', '1203@g.us')).toBe('g|1203@g.us');
    expect(sameChatKey('dm', '5491', '5491@c.us')).toBe('p|5491');
    expect(sameChatKey('dm', '', '77@lid')).toBe('j|77@lid');
    expect(sameChatKey('email', '', 'x')).toBe('');
    const rows = [
      { id: 'a', key: 'k1' },
      { id: 'b', key: 'k1' },
      { id: 'c', key: '' },
      { id: 'd', key: 'k2' },
    ];
    // La líder de k1 es "b" (por ejemplo, fijada); la de k2 quedó en otra página ("z").
    expect(collapseSameChats(rows, new Map([['k1', 'b'], ['k2', 'z']])).map((r) => r.id)).toEqual(['b', 'c']);
    expect(waKeyId('false_1203@g.us_3EB0AB_5491@c.us')).toBe('3EB0AB');
    expect(waKeyId('3EB0AB')).toBe('3EB0AB');
    const msgs = [
      { id: '1', pid: 'X', out: false },
      { id: '2', pid: 'X', out: true },
      { id: '3', pid: null, out: false },
      { id: '4', pid: 'Y', out: false },
      { id: '5', pid: 'Y', out: false },
    ];
    expect(dedupeLineMessages(msgs, (m) => m.pid, (m) => m.out).map((m) => m.id)).toEqual(['2', '3', '4']);
    const lines = [
      { chatId: 'a', lineId: 'A', name: 'A', unread: 0, lastMessageAt: null, canSend: true },
      { chatId: 'b', lineId: 'B', name: 'B', unread: 0, lastMessageAt: null, canSend: false },
    ];
    expect(defaultReplyLine(lines, 'b', 'a')?.chatId).toBe('a');
    expect(defaultReplyLine(lines, 'a', 'b')?.chatId).toBe('a');
  });
});

describe('Lines: el mismo chat en dos líneas', () => {
  it('la bandeja lo lista una vez con los no leídos sumados; el hilo junta y no repite', async () => {
    const ws = (await makeUser('sc-lines')).id;
    const ventas = await line(ws, 'Ventas demo');
    const soporte = await line(ws, 'Soporte demo');
    const jid = `1203${uniq()}@g.us`;
    // El mismo mensaje del grupo llega por las dos líneas (mismo id de WhatsApp).
    await ingestEvents(ventas, [ev(jid, { chatName: 'Grupo demo', providerMessageId: 'G-1', body: 'uno', timestamp: at(1) })]);
    await ingestEvents(soporte, [ev(jid, { chatName: 'Grupo demo', providerMessageId: 'G-1', body: 'uno', timestamp: at(1) })]);
    await ingestEvents(soporte, [ev(jid, { chatName: 'Grupo demo', providerMessageId: 'G-2', body: 'dos', timestamp: at(2) })]);
    // Un 1:1 con el mismo contacto por las dos líneas: conversaciones distintas que se juntan por teléfono.
    const p = phone();
    await ingestEvents(ventas, [ev(`${p}@c.us`, { body: 'por ventas', timestamp: at(3) })]);
    await ingestEvents(soporte, [ev(`${p}@c.us`, { body: 'por soporte', timestamp: at(4) })]);

    const rows = (await listChats(ws, ws, { cursor: '', limit: 50 })).rows;
    const groupRows = rows.filter((r) => r.kind === 'group');
    expect(groupRows).toHaveLength(1);
    expect(groupRows[0].lines?.map((l) => l.name).sort()).toEqual(['Soporte demo', 'Ventas demo']);
    // El grupo: el mensaje que llegó a las dos líneas cuenta una vez (la línea con más no leídos).
    expect(groupRows[0].unread).toBe(2);
    const dmRows = rows.filter((r) => r.kind === 'dm');
    expect(dmRows).toHaveLength(1);
    expect(dmRows[0].unread).toBe(2);
    // Paginado de a uno: el chat sigue apareciendo una sola vez.
    const seen: string[] = [];
    let cursor: string | null = '';
    while (cursor !== null) {
      const page = await listChats(ws, ws, { cursor, limit: 1 });
      seen.push(...page.rows.map((r) => r.kind));
      cursor = page.next ?? null;
    }
    expect(seen.sort()).toEqual(['dm', 'group']);
    // Filtrando por una línea, cada una muestra su chat (sin juntar).
    expect((await listChats(ws, ws, { numberId: ventas.id })).rows).toHaveLength(2);

    // El hilo: mensajes de las dos líneas, en orden, sin el repetido; cada uno con su chat (su línea).
    const groupChat = await getChatRow(ws, groupRows[0].id);
    const ids = await sameChatIds(ws, null, groupChat!);
    expect(ids).toHaveLength(2);
    const thread = await listMessages(ws, groupChat!.id, { chatIds: ids });
    expect(thread.filter((m) => m.direction === 'in').map((m) => m.body)).toEqual(['uno', 'dos']);
    expect(new Set(thread.map((m) => m.chatId)).size).toBeGreaterThanOrEqual(1);
    const dm = await getChatRow(ws, dmRows[0].id);
    const dmThread = await listMessages(ws, dm!.id, { chatIds: await sameChatIds(ws, null, dm!) });
    expect(dmThread.filter((m) => m.direction === 'in').map((m) => m.body)).toEqual(['por ventas', 'por soporte']);
    expect(new Set(dmThread.filter((m) => m.direction === 'in').map((m) => m.chatId)).size).toBe(2);

    // Archivar desde la fila vale para las dos líneas (la otra no vuelve a aparecer sola).
    const both = await withSameChatIds(ws, null, [dm!.id]);
    expect(both).toHaveLength(2);
    const { updateChat } = await import('@/lib/groups');
    for (const id of both) await updateChat(ws, id, { archived: true });
    expect((await listChats(ws, ws, { cursor: '', limit: 50 })).rows.filter((r) => r.kind === 'dm')).toHaveLength(0);
  });

  it('una línea que la persona no ve no suma ni aparece', async () => {
    const owner = await makeUser('sc-access');
    const member = await makeUser('sc-access-m');
    const { createTeam } = await import('@/lib/teams');
    await addMember((await createTeam(owner.id, 'Equipo demo')).id, member.id, 'member');
    const pub = await line(owner.id, 'Pública demo');
    const priv = await line(owner.id, 'Privada demo');
    const p = phone();
    await ingestEvents(pub, [ev(`${p}@c.us`, { body: 'público', timestamp: at(1) })]);
    await ingestEvents(priv, [ev(`${p}@c.us`, { body: 'privado', timestamp: at(2) })]);
    await setLineAccess(owner.id, priv.id, { visibility: 'restricted' });
    const viewer = await groupsViewer(owner.id, member.id, 'member');
    const rows = (await listChats(owner.id, member.id, { viewer, cursor: '', limit: 50 })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].lines).toBeUndefined();
    expect(rows[0].unread).toBe(1);
    const chat = await getChatRow(owner.id, rows[0].id);
    const thread = await listMessages(owner.id, chat!.id, { chatIds: await sameChatIds(owner.id, viewer, chat!) });
    expect(thread.map((m) => m.body)).toEqual(['público']);
    // El dueño ve las dos.
    const all = (await listChats(owner.id, owner.id, { cursor: '', limit: 50 })).rows;
    expect(all).toHaveLength(1);
    expect(all[0].lines).toHaveLength(2);
  });
});

describe('Inbox: el mismo chat en dos cuentas', () => {
  async function account(owner: string, label: string) {
    const a = await createAccount(owner, { kind: 'whatsapp', provider: 'fake', label });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
    return (await getAccountById(a.id))!;
  }

  it('una fila, no leídos sumados, conversación unida sin repetidos y acciones en las dos', async () => {
    const owner = (await makeUser('sc-inbox')).id;
    const personal = await account(owner, 'Personal demo');
    const trabajo = await account(owner, 'Trabajo demo');
    const jid = `1203${uniq()}@g.us`;
    await ingestWhatsappEvents(personal, [ev(jid, { chatName: 'Grupo demo', providerMessageId: 'IG-1', body: 'uno', timestamp: at(1) })]);
    await ingestWhatsappEvents(trabajo, [ev(jid, { chatName: 'Grupo demo', providerMessageId: 'IG-1', body: 'uno', timestamp: at(1) })]);
    await ingestWhatsappEvents(trabajo, [ev(jid, { chatName: 'Grupo demo', providerMessageId: 'IG-2', body: 'dos', timestamp: at(2) })]);
    const p = phone();
    await ingestWhatsappEvents(personal, [ev(`${p}@s.whatsapp.net`, { body: 'por personal', timestamp: at(3) })]);
    await ingestWhatsappEvents(trabajo, [ev(`${p}@s.whatsapp.net`, { body: 'por trabajo', timestamp: at(4) })]);

    const threads = await listThreads(owner);
    expect(threads.filter((t) => t.kind === 'group')).toHaveLength(1);
    const g = threads.find((t) => t.kind === 'group')!;
    expect(g.lines?.map((l) => l.name).sort()).toEqual(['Personal demo', 'Trabajo demo']);
    expect(g.unread).toBe(2);
    const dm = threads.find((t) => t.kind === 'dm')!;
    expect(threads.filter((t) => t.kind === 'dm')).toHaveLength(1);
    expect(dm.unread).toBe(2);
    // Paginado de a uno: cada chat una vez.
    const seen: string[] = [];
    let cursor: string | null = '';
    while (cursor !== null) {
      const page = await listThreadsPage(owner, { cursor: cursor || null, limit: 1 });
      seen.push(...page.threads.map((t) => t.kind));
      cursor = page.next;
    }
    expect(seen.sort()).toEqual(['dm', 'group']);

    const page = await listInboxMessages(owner, g.id);
    expect(page.messages.map((m) => m.body)).toEqual(['uno', 'dos']);
    const dmPage = await listInboxMessages(owner, dm.id);
    expect(dmPage.messages.map((m) => m.body)).toEqual(['por personal', 'por trabajo']);
    expect(new Set(dmPage.messages.map((m) => m.threadId)).size).toBe(2);

    // Hecho desde la fila: las dos cuentas.
    const personalDm = (await findThread(personal.id, `${p}@s.whatsapp.net`))!.id;
    await applyThreadAction(owner, await withInboxSameChatIds(owner, [personalDm]), { action: 'done' });
    expect((await listThreads(owner)).filter((t) => t.kind === 'dm')).toHaveLength(0);
  });
});
