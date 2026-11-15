/**
 * Invariantes de volver a importar o volver a vincular una línea de WhatsApp
 * (Inbox y Lines): se importa, la persona hace cosas (lee, archiva, fija,
 * destaca, reacciona, pone notas, carpetas y etiquetas, transcribe), y después
 * llega otra vez lo mismo de todas las formas en que puede llegar: igual, una
 * parte, en otro orden, con menos datos, por el id anónimo (lid) en vez del
 * teléfono, por el historial y con la instancia nueva de una línea que se
 * volvió a vincular. Nada se pierde y nada se duplica: las filas quedan
 * idénticas, columna por columna.
 *
 * Lo único que puede cambiar es para mejor: un archivo guardado sin su clave
 * la recibe (y se puede volver a bajar).
 *
 * Números, lids, nombres y textos inventados.
 */
import { existsSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createAccount, createFolder, findThread, getAccountById, saveNotes } from '@/lib/inbox/core';
import { applyPhoneChatState, connectWhatsapp, disconnectWhatsapp, ingestHistoryChats, ingestWhatsappEvents, readMediaRef } from '@/lib/inbox/whatsapp';
import { connectNumber, createLabel, createNumber, disconnectNumber, getNumberRowById, ingestEvents, setChatLabels, type NumberRow } from '@/lib/groups';
import { ingestHistory } from '@/lib/groups-import';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import type { InboundEvent } from '@/lib/groups-provider';
import { localUploadPath } from '@/lib/uploads';
import { mergeLidChats } from '@/lib/wa-dedupe-run';
import { readTranscript, transcribeMessage } from '@/lib/wa-extras';
import { mediaWireOf } from '@/lib/wa-media-wire';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('VOICE_TRANSCRIBE_PROVIDER', 'fake');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type Msg = Extract<InboundEvent, { type: 'message' }>;
type Row = Record<string, unknown>;

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
function person() {
  const n = Math.floor(10_000_000 + Math.random() * 89_999_999);
  return { phone: `54911${n}`, lid: `7${n}${Math.floor(100_000 + Math.random() * 899_999)}` };
}

const wire = (type: 'imageMessage' | 'audioMessage' | 'documentMessage', n: number) =>
  mediaWireOf(type, {
    mediaKey: Buffer.alloc(32, n).toString('base64'),
    directPath: `/v/t62.7118-24/${n}0000_${n}1111.enc?ccb=11-4&oh=abc&oe=def`,
    mimetype: type === 'imageMessage' ? 'image/png' : type === 'audioMessage' ? 'audio/ogg' : 'application/pdf',
    fileLength: 1000 + n,
  })!;

/**
 * Lo que trae una línea: dos personas y un grupo, con texto, una foto con texto, una nota de voz, un documento
 * guardado sin clave (como los de antes) y algo mandado desde el teléfono. `lines`: la media lleva el marcador
 * "evo:<id>" con que Lines la baja al llegar.
 */
function dataset(lines: boolean) {
  const a = person();
  const b = person();
  const group = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const tag = uniq();
  const at = (min: number) => new Date(Date.now() - 86_400_000 + min * 60_000).toISOString();
  const base = (chatId: string, p: { phone: string }, name: string, id: string, min: number, over: Partial<Msg> = {}): Msg =>
    ({
      type: 'message',
      chatId,
      isGroup: chatId.endsWith('@g.us'),
      fromMe: false,
      senderPhone: p.phone,
      senderName: name,
      providerMessageId: `${id}-${tag}`,
      body: '',
      timestamp: at(min),
      ...over,
    }) as Msg;
  const media = (id: string, type: string, name: string, info: NonNullable<NonNullable<Msg['media']>['info']>, w?: ReturnType<typeof wire>) => ({
    url: lines ? `evo:${id}-${tag}` : '',
    type,
    name,
    info,
    fetchRef: { providerMessageId: `${id}-${tag}`, chatId: '', fromMe: false, ...(w ? { wire: w } : {}) },
  });
  const pa = `${a.phone}@s.whatsapp.net`;
  const pb = `${b.phone}@s.whatsapp.net`;
  const withChat = (m: Msg): Msg => (m.media?.fetchRef ? { ...m, media: { ...m.media, fetchRef: { ...m.media.fetchRef, chatId: m.chatId } } } : m);
  const events: Msg[] = [
    base(pa, a, 'Ana Ejemplo', 'txt1', 1, { body: 'hola, ¿cómo va?' }),
    base(pa, a, 'Ana Ejemplo', 'img1', 2, { body: 'la foto del plano', media: media('img1', 'image/png', '', { kind: 'image', width: 480, height: 320 }, wire('imageMessage', 1)) as Msg['media'] }),
    base(pa, a, 'Ana Ejemplo', 'aud-1', 3, { media: media('aud-1', 'audio/ogg', '', { kind: 'voice', ptt: true, duration: 2 }, wire('audioMessage', 2)) as Msg['media'] }),
    base(pa, a, '', 'out1', 4, { fromMe: true, senderPhone: '', body: 'te contesto desde el teléfono', status: 'delivered' } as Partial<Msg>),
    base(pb, b, 'Beto Ejemplo', 'doc-1', 5, { media: media('doc-1', 'application/pdf', 'presupuesto.pdf', { kind: 'document', size: 2048 }) as Msg['media'] }),
    base(pb, b, 'Beto Ejemplo', 'txt2', 6, { body: 'te mando el presupuesto' }),
    base(group, a, 'Ana Ejemplo', 'grp1', 7, { body: 'nos vemos el jueves', chatName: 'Equipo Ejemplo' }),
    base(group, b, 'Beto Ejemplo', 'grp2', 8, { body: 'dale', chatName: 'Equipo Ejemplo' }),
  ].map(withChat);
  return { a, b, pa, pb, group, tag, events };
}

/** Las mismas llegando de otras formas. */
const variants = (d: ReturnType<typeof dataset>): Array<{ name: string; events: InboundEvent[]; history?: boolean }> => {
  const asLid = (e: Msg): Msg => {
    const p = e.chatId === d.pa ? d.a : e.chatId === d.pb ? d.b : null;
    if (!p) return e;
    const chatId = `${p.lid}@lid`;
    return { ...e, chatId, senderPhone: '', senderLid: e.fromMe ? undefined : p.lid, chatLid: p.lid, media: e.media?.fetchRef ? { ...e.media, fetchRef: { ...e.media.fetchRef, chatId } } : e.media } as Msg;
  };
  return [
    { name: 'lo mismo otra vez', events: d.events },
    { name: 'lo mismo por el historial', events: d.events.map((e) => ({ ...e, history: true })), history: true },
    { name: 'una parte', events: d.events.filter((_, i) => i % 2 === 0) },
    { name: 'en otro orden', events: [...d.events].reverse() },
    // Con menos datos que la primera vez: sin texto, sin nombre, sin archivo, sin estado.
    {
      name: 'con menos datos',
      events: d.events.map((e) => ({ ...e, body: '', senderName: '', chatName: undefined, status: undefined, media: e.media ? { url: '', type: '', name: '' } : undefined }) as unknown as InboundEvent),
    },
    // Por el id anónimo en vez del teléfono (la libreta ya sabe quién es quién).
    {
      name: 'por lid en vez de teléfono',
      events: [
        { type: 'contact', chatId: `${d.a.lid}@lid`, lid: d.a.lid, phone: d.a.phone } as InboundEvent,
        { type: 'contact', chatId: `${d.b.lid}@lid`, lid: d.b.lid, phone: d.b.phone } as InboundEvent,
        ...d.events.map(asLid),
      ],
    },
  ];
};

/** Todas las columnas menos las que se permiten cambiar (con su porqué). */
function strip(rows: Row[], allowed: string[]): Row[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !allowed.includes(k))));
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

describe('Inbox: importar, usar y volver a importar', () => {
  async function account(label: string) {
    const u = await makeUser(label);
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(a.id);
    return { u, acc: (await getAccountById(a.id))! };
  }

  /** El estado entero de la cuenta: chats, mensajes, carpetas de cada chat y transcripciones. */
  async function snapshot(accId: string, owner: string) {
    const db = getDb();
    const threads = (await db.prepare('SELECT * FROM inbox_threads WHERE account_id = ? ORDER BY external_id').all(accId)) as Row[];
    const messages = (await db
      .prepare('SELECT m.* FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.account_id = ? ORDER BY m.external_id, m.thread_id')
      .all(accId)) as Row[];
    const folders = (await db
      .prepare('SELECT f.thread_id, f.folder_id FROM inbox_thread_folders f JOIN inbox_threads t ON t.id = f.thread_id WHERE t.account_id = ? ORDER BY 1, 2')
      .all(accId)) as Row[];
    const transcripts = (await db.prepare("SELECT message_id, status, text, summary, error FROM wa_transcripts WHERE scope = 'inbox' AND owner_id = ? ORDER BY message_id").all(owner)) as Row[];
    return {
      // updated_at: la fila se toca al pasar (no es estado de la persona). info_at/avatar: datos del contacto que se refrescan.
      threads: strip(threads, ['updated_at']),
      messages,
      folders,
      transcripts,
    };
  }

  /** Lo que hace la persona después de importar. */
  async function useIt(owner: string, accId: string, d: ReturnType<typeof dataset>) {
    const db = getDb();
    const ta = (await findThread(accId, d.pa))!;
    const tb = (await findThread(accId, d.pb))!;
    const tg = (await findThread(accId, d.group))!;
    const id = async (ext: string) => String(((await db.prepare('SELECT id FROM inbox_messages WHERE thread_id IN (?, ?, ?) AND external_id = ?').get(ta.id, tb.id, tg.id, `${ext}-${d.tag}`)) as Row).id);
    await saveNotes(owner, ta.id, 'cliente desde marzo');
    const folder = await createFolder(owner, { name: `Clientes ${uniq()}` });
    await db.prepare('INSERT INTO inbox_thread_folders (thread_id, folder_id) VALUES (?, ?)').run(ta.id, folder.id);
    // Leídos, uno fijado, uno hecho, uno archivado a mano y otro sacado de archivados.
    await db.prepare('UPDATE inbox_threads SET unread = 0 WHERE account_id = ?').run(accId);
    await db.prepare('UPDATE inbox_threads SET pinned_at = ? WHERE id = ?').run(new Date().toISOString(), ta.id);
    await db.prepare('UPDATE inbox_threads SET done_at = ? WHERE id = ?').run(new Date().toISOString(), tb.id);
    await db.prepare('UPDATE inbox_threads SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), tg.id);
    // Destacado, reacción, borrado para mí.
    await db.prepare('UPDATE inbox_messages SET starred_at = ? WHERE id = ?').run(new Date().toISOString(), await id('img1'));
    await db.prepare("UPDATE inbox_messages SET reactions = ? WHERE id = ?").run(JSON.stringify([{ emoji: '👍', fromMe: true }]), await id('txt1'));
    await db.prepare('UPDATE inbox_messages SET hidden_at = ? WHERE id = ?').run(new Date().toISOString(), await id('txt2'));
    // La nota de voz, transcripta.
    const t = await transcribeMessage('inbox', owner, await id('aud-1'), async () => ({ data: Buffer.from('RIFF....WAVE'), mimetype: 'audio/wav', seconds: 2 }));
    expect(t.status).toBe('done');
    return { ta, tb, tg, id };
  }

  it('nada cambia al volver a importar: igual, una parte, otro orden, menos datos, por lid, por el historial', async () => {
    const { u, acc } = await account('inv-in1');
    const d = dataset(false);
    await ingestWhatsappEvents(acc, d.events, { history: true });
    await useIt(u.id, acc.id, d);
    const before = await snapshot(acc.id, u.id);
    expect(before.threads).toHaveLength(3);
    expect(before.messages).toHaveLength(d.events.length);
    for (const v of variants(d)) {
      await ingestWhatsappEvents(acc, v.events, { history: v.history });
      expect(await snapshot(acc.id, u.id), v.name).toEqual(before);
    }
  });

  it('mensajes nuevos en vivo sí mueven el chat; los repetidos no vuelven a contar como no leídos', async () => {
    const { u, acc } = await account('inv-in2');
    const d = dataset(false);
    await ingestWhatsappEvents(acc, d.events);
    const db = getDb();
    await db.prepare('UPDATE inbox_threads SET unread = 0 WHERE account_id = ?').run(acc.id);
    // Los mismos, ahora "en vivo" (un reintento del gateway): siguen leídos.
    await ingestWhatsappEvents(acc, d.events);
    const unread = (await db.prepare('SELECT SUM(unread) AS n FROM inbox_threads WHERE account_id = ?').get(acc.id)) as { n: number };
    expect(Number(unread.n)).toBe(0);
    expect((await snapshot(acc.id, u.id)).messages).toHaveLength(d.events.length);
  });

  it('desvincular y volver a vincular: la misma cuenta y los mismos chats; el historial que vuelve no cambia nada', async () => {
    const { u, acc } = await account('inv-in3');
    const d = dataset(false);
    await ingestWhatsappEvents(acc, d.events, { history: true });
    await useIt(u.id, acc.id, d);
    const before = await snapshot(acc.id, u.id);
    await disconnectWhatsapp((await getAccountById(acc.id))!);
    const { account: again } = await connectWhatsapp(u.id);
    expect(again.id).toBe(acc.id);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(acc.id);
    const linked = (await getAccountById(acc.id))!;
    expect(linked.linked_at).toBeTruthy();
    for (const v of variants(d)) {
      await ingestWhatsappEvents(linked, v.events, { history: true });
      expect(await snapshot(acc.id, u.id), v.name).toEqual(before);
    }
    // Con el historial, el teléfono vuelve a decir cómo tiene cada chat (la lista de chats y la importación de lo que
    // guardó el servidor): todos archivados y con no leídos. Los chats ya estaban: no se pisa nada. Sin tocar fechas:
    // los chats tienen segundos, pero son anteriores a esta vinculación.
    await ingestHistoryChats(linked, [{ remoteJid: d.pa, archived: true }, { remoteJid: d.pb, archived: true }, { remoteJid: d.group, name: 'Equipo Ejemplo', archive: true }]);
    for (const jid of [d.pa, d.pb, d.group]) {
      expect(await applyPhoneChatState(linked, (await findThread(acc.id, jid))!, { archived: true, unread: 7 })).toBe(false);
    }
    expect(await snapshot(acc.id, u.id), 'estado del teléfono').toEqual(before);
    // Un chat que entra con esta vinculación sí llega como está en el teléfono.
    const nuevo = `${person().phone}@s.whatsapp.net`;
    await ingestHistoryChats(linked, [{ remoteJid: nuevo, archived: true }]);
    const fresh = (await findThread(acc.id, nuevo))!;
    expect(fresh.archived_at).not.toBeNull();
    expect(await applyPhoneChatState(linked, fresh, { unread: 4 })).toBe(true);
    expect((await findThread(acc.id, nuevo))!.unread).toBe(4);
  });

  it('cuenta vinculada antes de guardar cuándo: el teléfono solo manda en los chats de la última hora', async () => {
    const { u, acc } = await account('inv-in4');
    const d = dataset(false);
    await ingestWhatsappEvents(acc, d.events, { history: true });
    const { ta } = await useIt(u.id, acc.id, d);
    // El chat ya estaba hace días (no entró con esta vinculación).
    await getDb().prepare('UPDATE inbox_threads SET created_at = ? WHERE account_id = ?').run(new Date(Date.now() - 3 * 86_400_000).toISOString(), acc.id);
    const before = await snapshot(acc.id, u.id);
    await ingestHistoryChats(acc, [{ remoteJid: d.pa, archived: true }, { remoteJid: d.pb, archived: true }, { remoteJid: d.group, name: 'Equipo Ejemplo', archive: true }]);
    expect(await snapshot(acc.id, u.id)).toEqual(before);
    const row = (await getDb().prepare('SELECT archived_at, pinned_at FROM inbox_threads WHERE id = ?').get(ta.id)) as Row;
    expect(row.archived_at).toBeNull();
    expect(row.pinned_at).not.toBeNull();
    // Un chat que entra recién sí llega archivado, como en el teléfono.
    const nuevo = `${person().phone}@s.whatsapp.net`;
    await ingestHistoryChats(acc, [{ remoteJid: nuevo, archived: true }]);
    expect((await findThread(acc.id, nuevo))!.archived_at).not.toBeNull();
  });

  it('un archivo guardado sin su clave la recibe cuando el mensaje vuelve a llegar (y nada más cambia)', async () => {
    const { u, acc } = await account('inv-in5');
    const d = dataset(false);
    await ingestWhatsappEvents(acc, d.events, { history: true });
    const { id } = await useIt(u.id, acc.id, d);
    const docId = await id('doc-1');
    const ref = async () => String(((await getDb().prepare('SELECT media_ref FROM inbox_messages WHERE id = ?').get(docId)) as Row).media_ref);
    expect(readMediaRef(await ref())?.wire).toBeUndefined();
    const before = await snapshot(acc.id, u.id);
    const w = wire('documentMessage', 9);
    const again = d.events.map((e) => (e.providerMessageId.startsWith('doc-1') ? ({ ...e, media: { ...e.media!, fetchRef: { ...e.media!.fetchRef!, wire: w } } } as Msg) : e));
    await ingestWhatsappEvents(acc, again, { history: true });
    expect(readMediaRef(await ref())?.wire).toEqual(w);
    // La clave no queda en claro en la base.
    expect(await ref()).not.toContain(w.mediaKey);
    const after = await snapshot(acc.id, u.id);
    // rev: el contador de cambios del chat (la pantalla lo usa para refrescar) sube porque el mensaje cambió.
    const same = (s: typeof after) => ({ ...s, threads: strip(s.threads, ['rev']), messages: s.messages.map((m) => (m.id === docId ? { ...m, media_ref: '' } : m)) });
    expect(same(after)).toEqual(same(before));
  });

  it('juntar el chat del lid con el del teléfono conserva la copia que se puede bajar y la transcripción', async () => {
    const { u, acc } = await account('inv-in6');
    const p = person();
    const pn = `${p.phone}@s.whatsapp.net`;
    const lid = `${p.lid}@lid`;
    const mid = `aud-${uniq()}`;
    const voice = (chatId: string, w?: ReturnType<typeof wire>): InboundEvent =>
      ({
        type: 'message',
        chatId,
        isGroup: false,
        fromMe: false,
        senderPhone: chatId === pn ? p.phone : '',
        senderName: 'Ana Ejemplo',
        providerMessageId: mid,
        body: '',
        media: { url: '', type: 'audio/ogg', name: '', info: { kind: 'voice', ptt: true, duration: 2 }, fetchRef: { providerMessageId: mid, chatId, fromMe: false, ...(w ? { wire: w } : {}) } },
        timestamp: new Date(Date.now() - 3_600_000).toISOString(),
      }) as InboundEvent;
    // Antes: en el chat del teléfono, solo con el id del mensaje (la instancia de entonces ya no existe).
    await ingestWhatsappEvents(acc, [voice(pn)], { history: true });
    const db = getDb();
    const old = (await db.prepare('SELECT id, thread_id FROM inbox_messages WHERE external_id = ?').get(mid)) as { id: string; thread_id: string };
    // Después de volver a vincular: el mismo mensaje llega al chat del lid, con la clave. La persona lo escucha y lo transcribe ahí.
    const w = wire('audioMessage', 5);
    await db.prepare("INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, title, handle, created_at, updated_at) VALUES (?, ?, ?, 'whatsapp', 'dm', ?, '', '', ?, ?)").run(`th_${uniq()}`, u.id, acc.id, lid, new Date().toISOString(), new Date().toISOString());
    const lidThread = (await findThread(acc.id, lid))!;
    const { addMessage } = await import('@/lib/inbox/core');
    const { storedMediaRef } = await import('@/lib/inbox/whatsapp');
    await addMessage(lidThread, { externalId: mid, fromMe: false, body: '', mediaType: 'audio', mediaRef: storedMediaRef({ providerMessageId: mid, chatId: lid, fromMe: false, wire: w }), history: true, sentAt: new Date(Date.now() - 3_600_000).toISOString() });
    const twin = (await db.prepare('SELECT id FROM inbox_messages WHERE external_id = ? AND thread_id = ?').get(mid, lidThread.id)) as { id: string };
    await db.prepare('UPDATE inbox_messages SET starred_at = ? WHERE id = ?').run(new Date().toISOString(), twin.id);
    expect((await transcribeMessage('inbox', u.id, twin.id, async () => ({ data: Buffer.from('RIFF....WAVE'), mimetype: 'audio/wav', seconds: 2 }))).status).toBe('done');

    // En el chat del teléfono había quedado un intento fallido (el audio no se podía bajar): gana la hecha.
    await transcribeMessage('inbox', u.id, old.id, async () => {
      throw Object.assign(new Error('x'), { code: 'media_gone' });
    });
    expect((await readTranscript('inbox', u.id, old.id))?.status).toBe('failed');

    const counts = await mergeLidChats('inbox', acc.id, { pairs: [{ loser: lidThread.id, survivor: old.thread_id, lid: p.lid, phone: p.phone }] });
    expect(counts).toMatchObject({ merged: 1, messages: 1 });

    const left = (await db.prepare('SELECT id, thread_id, media_ref, starred_at FROM inbox_messages WHERE external_id = ?').all(mid)) as Array<{ id: string; thread_id: string; media_ref: string; starred_at: string | null }>;
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(old.id);
    expect(readMediaRef(left[0].media_ref)?.wire).toEqual(w);
    expect(left[0].starred_at).not.toBeNull();
    expect((await readTranscript('inbox', u.id, old.id))?.status).toBe('done');
    expect(await readTranscript('inbox', u.id, twin.id)).toBeNull();
    expect(await findThread(acc.id, lid)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

describe('Lines: importar, usar y volver a importar', () => {
  async function line(label: string) {
    const user = await makeUser(label);
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
    return { user, row: (await getNumberRowById(n.id))! };
  }

  async function snapshot(numberId: string, ws: string) {
    const db = getDb();
    const chats = (await db.prepare('SELECT * FROM groups_chats WHERE number_id = ? ORDER BY provider_chat_id').all(numberId)) as Row[];
    const messages = (await db.prepare("SELECT * FROM groups_messages WHERE number_id = ? ORDER BY COALESCE(provider_message_id, id), chat_id").all(numberId)) as Row[];
    const labels = (await db.prepare('SELECT l.chat_id, l.label_id FROM groups_chat_labels l JOIN groups_chats c ON c.id = l.chat_id WHERE c.number_id = ? ORDER BY 1, 2').all(numberId)) as Row[];
    const transcripts = (await db.prepare("SELECT message_id, status, text, summary, error FROM wa_transcripts WHERE scope = 'lines' AND owner_id = ? ORDER BY message_id").all(ws)) as Row[];
    return { chats: strip(chats, ['updated_at']), messages, labels, transcripts };
  }

  /** Cada archivo guardado sigue en su lugar (los bytes, no solo la fila). */
  async function storedFiles(numberId: string): Promise<string[]> {
    const rows = (await getDb().prepare("SELECT media_url FROM groups_messages WHERE number_id = ? AND media_type <> '' ORDER BY provider_message_id").all(numberId)) as Array<{ media_url: string }>;
    for (const r of rows) {
      expect(r.media_url, 'el archivo quedó guardado').toMatch(/^\/uploads\//);
      expect(existsSync(localUploadPath(r.media_url)!), 'los bytes siguen en disco').toBe(true);
    }
    return rows.map((r) => r.media_url);
  }

  async function useIt(ws: string, row: NumberRow, d: ReturnType<typeof dataset>) {
    const db = getDb();
    const chat = async (jid: string) => (await db.prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(row.id, jid)) as { id: string };
    const id = async (ext: string) => String(((await db.prepare('SELECT id FROM groups_messages WHERE number_id = ? AND provider_message_id = ?').get(row.id, `${ext}-${d.tag}`)) as Row).id);
    const ca = await chat(d.pa);
    const cb = await chat(d.pb);
    const label = await createLabel(ws, { name: `VIP ${uniq()}` });
    await setChatLabels(ws, ca.id, [label.id]);
    await db.prepare('UPDATE groups_chats SET unread_count = 0 WHERE number_id = ?').run(row.id);
    await db.prepare('UPDATE groups_chats SET pinned_at = ? WHERE id = ?').run(new Date().toISOString(), ca.id);
    await db.prepare('UPDATE groups_chats SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), cb.id);
    await db.prepare("UPDATE groups_messages SET reactions = ? WHERE id = ?").run(JSON.stringify([{ emoji: '👍', by: 'me' }]), await id('txt1'));
    await db.prepare("UPDATE groups_messages SET meta = json_set(CASE WHEN json_valid(meta) THEN meta ELSE '{}' END, '$.starred', json('true')) WHERE id = ?").run(await id('img1'));
    await db.prepare('UPDATE groups_messages SET pinned_at = ? WHERE id = ?').run(new Date().toISOString(), await id('txt2'));
    // Una nota interna (no viene de WhatsApp) y la nota de voz transcripta.
    await db
      .prepare("INSERT INTO groups_messages (id, user_id, chat_id, number_id, direction, author_kind, body, status, created_at) VALUES (?, ?, ?, ?, 'note', 'user', 'llamar el lunes', 'sent', ?)")
      .run(`gm_${uniq()}`, ws, ca.id, row.id, new Date().toISOString());
    const t = await transcribeMessage('lines', ws, await id('aud-1'), async () => ({ data: Buffer.from('RIFF....WAVE'), mimetype: 'audio/wav', seconds: 2 }));
    expect(t.status).toBe('done');
  }

  it('nada cambia al volver a importar ni al volver a vincular, y los archivos guardados siguen ahí', async () => {
    const { user, row } = await line('inv-ln1');
    const d = dataset(true);
    // En vivo: los archivos se bajan y se guardan al llegar.
    await ingestEvents(row, d.events);
    await useIt(user.id, row, d);
    const files = await storedFiles(row.id);
    expect(files).toHaveLength(3);
    const before = await snapshot(row.id, user.id);
    expect(before.chats).toHaveLength(3);
    expect(before.messages).toHaveLength(d.events.length + 1);

    for (const v of variants(d)) {
      // En vivo (un reintento del gateway) y como historial.
      await ingestEvents(row, v.events, v.history ? { history: true } : {});
      expect(await snapshot(row.id, user.id), `webhook en vivo: ${v.name}`).toEqual(before);
      await ingestEvents(row, v.events, { history: true });
      expect(await snapshot(row.id, user.id), `webhook: ${v.name}`).toEqual(before);
      // Y por la importación del historial (el otro camino por el que llega lo mismo).
      await ingestHistory(row, v.events);
      expect(await snapshot(row.id, user.id), `importación: ${v.name}`).toEqual(before);
    }
    expect(await storedFiles(row.id)).toEqual(files);

    // Desvincular y volver a vincular: la misma línea y los mismos chats.
    await disconnectNumber(user.id, row.id);
    await connectNumber(user.id, row.id);
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(row.id);
    const linked = (await getNumberRowById(row.id))!;
    expect(linked.id).toBe(row.id);
    for (const v of variants(d)) {
      await ingestEvents(linked, v.events, { history: true });
      expect(await snapshot(row.id, user.id), `vinculada de nuevo: ${v.name}`).toEqual(before);
    }
    expect(await storedFiles(row.id)).toEqual(files);
  });

  it('un archivo que quedó sin bajar y sin clave la recibe cuando el mensaje vuelve a llegar (y nada más cambia)', async () => {
    const { user, row } = await line('inv-ln2');
    const d = dataset(true);
    await ingestEvents(row, d.events, { history: true });
    await useIt(user.id, row, d);
    const db = getDb();
    const docPid = `doc-1-${d.tag}`;
    // Como quedaban los que WhatsApp ya no tenía: sin archivo, marcado, sin clave.
    await db.prepare("UPDATE groups_messages SET media_url = '', meta = json_set(meta, '$.mediaGone', json('true')) WHERE number_id = ? AND provider_message_id = ?").run(row.id, docPid);
    const before = await snapshot(row.id, user.id);
    const w = wire('documentMessage', 9);
    const again = d.events.map((e) => (e.providerMessageId === docPid ? ({ ...e, media: { ...e.media!, fetchRef: { ...e.media!.fetchRef!, wire: w } } } as Msg) : e));
    await ingestEvents(row, again, { history: true });
    const meta = JSON.parse(String(((await db.prepare('SELECT meta FROM groups_messages WHERE number_id = ? AND provider_message_id = ?').get(row.id, docPid)) as Row).meta)) as Record<string, unknown>;
    expect(meta.mediaWire).toMatchObject({ directPath: w.directPath });
    expect(JSON.stringify(meta)).not.toContain(w.mediaKey);
    // Con la clave se puede volver a pedir: ya no figura como perdido.
    expect(meta.mediaGone).toBeUndefined();
    const after = await snapshot(row.id, user.id);
    const same = (s: typeof after) => ({ ...s, messages: s.messages.map((m) => (m.provider_message_id === docPid ? { ...m, meta: '' } : m)) });
    expect(same(after)).toEqual(same(before));
  });
});
