import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { GroupsError } from '@/lib/groups';
import {
  cancelHistory,
  getHistoryStatus,
  periskopeMediaFetcher,
  queueHistory,
  runHistoryChunk,
  waIdOf,
  type HistoryClients,
  type PskMessage,
} from '@/lib/groups-periskope-history';
import type { PeriskopeFetch } from '@/lib/groups-periskope-api';
import { makeUser } from './helpers';

/** Lines › Migrar › Historial de mensajes de Periskope (lib/groups-periskope-history.ts). Datos inventados. */

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

async function line(ws: string, phone: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name: `Linea ${phone.slice(-4)}` });
  await connectNumber(ws, n.id);
  await getDb().prepare("UPDATE groups_numbers SET phone = ?, status = 'connected' WHERE id = ?").run(phone, n.id);
  return (await getNumberRowById(n.id))!;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const DM = '5490000000731@c.us';
const msg = (n: number, over: Partial<PskMessage> = {}): PskMessage => ({
  message_id: `false_${DM}_WA${n}`,
  unique_id: `WA${n}`,
  chat_id: DM,
  from_me: false,
  sender_phone: DM,
  body: `texto ${n}`,
  message_type: 'chat',
  ack: '3',
  timestamp: `2025-02-0${n}T10:00:00.000Z`,
  ...over,
});

/** Una cuenta de Periskope en memoria. `messages` va del más nuevo al más viejo, como la API. */
function account(opts: { messages: PskMessage[]; line: string; failOnce?: boolean }): { clients: HistoryClients; calls: string[]; mediaCalls: string[] } {
  const calls: string[] = [];
  const mediaCalls: string[] = [];
  let failed = false;
  const get = (async (path: string) => {
    calls.push(path);
    if (opts.failOnce && !failed && /\/messages/.test(path)) {
      failed = true;
      throw new GroupsError('periskope_rate_limited', 429);
    }
    const u = new URL(path, 'https://x.test');
    const offset = Number(u.searchParams.get('offset') ?? 0);
    const limit = Number(u.searchParams.get('limit') ?? 1000);
    if (u.pathname === '/phones/all') return [{ phone_id: 'p1' }];
    if (u.pathname === '/chats') return { chats: offset > 0 ? [] : [{ chat_id: DM, chat_name: 'Cliente de prueba', org_phone: `${opts.line}@c.us` }] };
    if (u.pathname === `/chats/${encodeURIComponent(DM)}/messages`) return { messages: opts.messages.slice(offset, offset + limit) };
    if (u.pathname === '/reactions') return { reactions: offset > 0 ? [] : [{ unique_id: 'WA1', sender_id: DM, reaction: '👍', timestamp: '2025-02-01T10:05:00.000Z' }] };
    if (u.pathname === `/chats/${encodeURIComponent(DM)}/notes`) return { notes: [] };
    throw new Error(`unexpected ${path}`);
  }) as PeriskopeFetch;
  const media = async (url: string) => {
    mediaCalls.push(url);
    return url.includes('missing') ? null : { data: PNG, mimetype: 'image/png', filename: 'a.png' };
  };
  return { clients: { get, media }, calls, mediaCalls };
}

async function runAll(ws: string, clients: HistoryClients, now = new Date()) {
  let st = await runHistoryChunk(ws, { clients, budgetMs: 20_000, now });
  for (let i = 0; i < 10 && st && st.status !== 'done' && st.status !== 'error'; i++) st = await runHistoryChunk(ws, { clients, budgetMs: 20_000, now: new Date(now.getTime() + (i + 1) * 3_600_000) });
  return st;
}

describe('historial de Periskope', () => {
  it('trae todo, sin duplicar lo recibido por WhatsApp, con respuestas, reacciones y archivos privados', async () => {
    const user = await makeUser('psk-h');
    const a = await line(user.id, '5490000000100');
    // Ya llegó por WhatsApp (mismo id de WhatsApp): no se duplica. También deja el chat sin leer.
    await ingestEvents(a, [
      { type: 'message', chatId: '5490000000731@s.whatsapp.net', isGroup: false, fromMe: false, senderPhone: '5490000000731', senderName: 'Persona de prueba', providerMessageId: 'WA1', body: 'texto 1', timestamp: Date.parse('2025-02-01T10:00:00.000Z') },
    ]);
    const chat = (await getDb().prepare('SELECT id, unread_count FROM groups_chats WHERE user_id = ?').get(user.id)) as { id: string; unread_count: number };
    const acc = account({
      line: '5490000000100',
      messages: [
        msg(4, { quoted_message_id: `false_${DM}_WA1` }),
        msg(3, { from_me: true, message_id: `true_${DM}_WA3`, body: 'con foto', message_type: 'image', media: { path: 'https://api.periskope.app/app/media/abc', mimetype: 'image/png', filename: 'foto.png' }, performed_by: null }),
        msg(2, { is_deleted: true }),
        msg(1),
      ],
    });
    await queueHistory(user.id, 'clave-de-prueba');
    const sealed = (await getDb().prepare('SELECT key_sealed FROM groups_periskope_history WHERE ws = ?').get(user.id)) as { key_sealed: string };
    expect(sealed.key_sealed).not.toContain('clave-de-prueba');

    const st = await runAll(user.id, acc.clients);
    expect(st).toMatchObject({ status: 'done', chatsDone: 1, messages: 3, duplicates: 1, mediaSaved: 1, mediaFailed: 0, reactions: 1 });
    const rows = (await getDb().prepare('SELECT * FROM groups_messages WHERE chat_id = ? ORDER BY provider_message_id').all(chat.id)) as Array<Record<string, string | null>>;
    expect(rows.map((r) => r.provider_message_id)).toEqual(['WA1', 'WA2', 'WA3', 'WA4']);
    expect(rows[0].body).toBe('texto 1');
    // Fecha original, dirección, borrado.
    expect(String(rows[2].created_at)).toBe('2025-02-03T10:00:00.000Z');
    expect(rows[2].direction).toBe('out');
    expect(rows[1].deleted_at).toBeTruthy();
    // Archivo en nuestro storage privado: nunca la URL de Periskope.
    expect(String(rows[2].media_url)).toMatch(/^\/api\/files\//);
    expect(JSON.stringify(rows)).not.toContain('periskope.app');
    // La respuesta quedó enlazada al mensaje citado.
    expect(rows[3].reply_to_id).toBe(rows[0].id);
    // Reacción.
    expect(String(rows[0].reactions)).toContain('👍');
    // Nada de no leídos ni espera por lo importado.
    const after = (await getDb().prepare('SELECT unread_count, awaiting_since FROM groups_chats WHERE id = ?').get(chat.id)) as { unread_count: number; awaiting_since: string | null };
    expect(after.unread_count).toBe(chat.unread_count);
    // La clave se borró al terminar.
    expect(((await getDb().prepare('SELECT key_sealed FROM groups_periskope_history WHERE ws = ?').get(user.id)) as { key_sealed: string }).key_sealed).toBe('');

    // Idempotente: otra corrida no agrega nada y no baja los archivos otra vez.
    const mediaBefore = acc.mediaCalls.length;
    await queueHistory(user.id, 'clave-de-prueba');
    const again = await runAll(user.id, acc.clients);
    expect(again).toMatchObject({ status: 'done', messages: 0, mediaSaved: 0 });
    expect(acc.mediaCalls.length).toBe(mediaBefore);
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ?').get(chat.id)) as { n: number }).n).toBe(4);
  });

  it('un chat sin línea que coincida se saltea, y nada cruza de workspace', async () => {
    const user = await makeUser('psk-h2');
    const other = await makeUser('psk-h3');
    await line(user.id, '5490000000101');
    const acc = account({ line: '5490000000999', messages: [msg(1)] });
    await queueHistory(user.id, 'clave-2');
    const st = await runAll(user.id, acc.clients);
    // Hay una sola línea en el workspace y el teléfono de Periskope no es el suyo: el chat se crea solo si coincide.
    expect(st?.status).toBe('done');
    expect(st?.chatsSkipped).toBe(1);
    expect(st?.messages).toBe(0);
    expect(await getHistoryStatus(other.id)).toBeNull();
  });

  it('con 429 espera sin gastar intentos y retoma; cancelar borra la clave', async () => {
    const user = await makeUser('psk-h4');
    const a = await line(user.id, '5490000000102');
    await ingestEvents(a, [
      { type: 'message', chatId: '5490000000731@s.whatsapp.net', isGroup: false, fromMe: false, senderPhone: '5490000000731', senderName: 'Persona de prueba', providerMessageId: 'WA9', body: 'hola' },
    ]);
    const acc = account({ line: '5490000000102', messages: [msg(1)], failOnce: true });
    await queueHistory(user.id, 'clave-3');
    const first = await runHistoryChunk(user.id, { clients: acc.clients, budgetMs: 10_000 });
    expect(first).toMatchObject({ status: 'running', error: 'periskope_rate_limited' });
    const row = (await getDb().prepare('SELECT attempts FROM groups_periskope_history WHERE ws = ?').get(user.id)) as { attempts: number };
    expect(row.attempts).toBe(0);
    const done = await runAll(user.id, acc.clients, new Date(Date.now() + 120_000));
    expect(done).toMatchObject({ status: 'done', messages: 1 });

    await queueHistory(user.id, 'clave-4');
    const cancelled = await cancelHistory(user.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(((await getDb().prepare('SELECT key_sealed FROM groups_periskope_history WHERE ws = ?').get(user.id)) as { key_sealed: string }).key_sealed).toBe('');
  });

  it('el id de WhatsApp sale de unique_id o del message_id', () => {
    expect(waIdOf({ message_id: 'true_123@c.us_ABC', unique_id: 'XYZ' })).toBe('XYZ');
    expect(waIdOf({ message_id: 'true_123@c.us_ABC' })).toBe('ABC');
    expect(waIdOf({ message_id: 'false_123@g.us_ABC_555@c.us' })).toBe('ABC');
  });
});

describe('descarga de archivos de Periskope', () => {
  it('solo https a hosts de Periskope, y la clave solo viaja a periskope.app', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      if (url.includes('api.periskope.app')) return new Response(null, { status: 302, headers: { location: 'https://storage.googleapis.com/b/file.png' } });
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    }) as unknown as typeof fetch;
    const dl = periskopeMediaFetcher('clave', fake);
    const ok = await dl('https://api.periskope.app/app/media/x', 1_000_000);
    expect(ok?.mimetype).toBe('image/png');
    expect(seen[0].auth).toBe('Bearer clave');
    expect(seen[1].auth).toBeNull();
    seen.length = 0;
    expect(await dl('http://api.periskope.app/app/media/x', 1_000_000)).toBeNull();
    expect(await dl('https://evil.example.com/x', 1_000_000)).toBeNull();
    expect(await dl('https://api.periskope.app.evil.com/x', 1_000_000)).toBeNull();
    expect(seen).toEqual([]);
  });
});
