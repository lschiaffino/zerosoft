/**
 * Lines: una cuenta de Periskope simulada para tests y demo
 * (GROUPS_PERISKOPE_FAKE=1). Responde las rutas que usa
 * lib/groups-periskope-api.ts con la forma de la API pública de Periskope
 * (docs.periskope.app/api-reference), armada sobre los chats que el workspace
 * ya tiene en Lines: así la importación encuentra a qué aplicarse. Los datos
 * son inventados. Nada sale a internet. Server-only.
 *
 * Una clave que contiene "invalid" responde 401, como Periskope con una clave
 * revocada. Los ids de tickets y notas llevan la clave: otra clave es otra
 * cuenta (los tests no chocan con lo que importó otro).
 */
import { getDb } from './db';
import { GroupsError } from './groups';
import type { PeriskopeFetch } from './groups-periskope-api';
import type { PeriskopeMediaFetch } from './groups-periskope-history';

export const FAKE_PERISKOPE_LABEL = 'Periskope VIP';
export const FAKE_PERISKOPE_CONTACT_LABEL = 'Periskope client';
export const FAKE_PERISKOPE_PROPERTY = 'Periskope plan';

type Row = { provider_chat_id: string; kind: string; name: string; phone: string; number_phone: string | null };

export function fakePeriskope(ws: string, key: string): PeriskopeFetch {
  return async (path) => {
    if (/invalid/i.test(key)) throw new GroupsError('periskope_auth', 400);
    const url = new URL(path, 'https://fake.periskope.local');
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const db = getDb();
    // Los chats más nuevos: el que acaba de crear un test (o la demo) queda primero, con la nota y el primer ticket.
    // Con los más viejos, la nota caía en un chat que había dejado otro test antes y que la importación no siempre encuentra.
    const rows = (await db
      .prepare(
        `SELECT c.provider_chat_id, c.kind, c.name, c.phone, n.phone AS number_phone FROM groups_chats c LEFT JOIN groups_numbers n ON n.id = c.number_id
         WHERE c.user_id = ? AND c.provider_chat_id != '' ORDER BY c.created_at DESC, c.id DESC LIMIT 4`,
      )
      .all(ws)) as Row[];
    const owner = (await db.prepare('SELECT email FROM users WHERE id = ?').get(ws)) as { email: string } | undefined;
    const jid = (r: Row) => (r.kind === 'group' ? r.provider_chat_id : `${r.phone || r.provider_chat_id.replace(/@.*$/, '')}@c.us`);
    const page = <T>(items: T[]) => (offset > 0 ? [] : items);
    const tag = key.replace(/[^a-z0-9]/gi, '').slice(-12) || 'key';
    switch (url.pathname) {
      case '/phones/all':
        return [...new Set(rows.map((r) => r.number_phone).filter(Boolean))].map((p, i) => ({ phone_id: `phone-fake${i}`, org_phone: `${p}@c.us`, phone_name: `Line ${i + 1}`, wa_state: 'CONNECTED' }));
      case '/properties':
        return {
          success: true,
          data: [
            {
              property_id: 'property-fakeplan',
              property_name: FAKE_PERISKOPE_PROPERTY,
              type: 'chat',
              kind: 'dropdown',
              options: [
                { id: '1', label: 'Pro' },
                { id: '2', label: 'Basic' },
              ],
            },
          ],
        };
      case '/chats':
        return {
          chats: page(
            rows.map((r, i) => ({
              chat_id: jid(r),
              chat_name: r.name,
              chat_type: r.kind === 'group' ? 'group' : 'user',
              org_phone: r.number_phone ? `${r.number_phone}@c.us` : null,
              labels: i === 0 ? [FAKE_PERISKOPE_LABEL] : [],
              assigned_to: i === 0 ? (owner?.email ?? null) : null,
              // Por id, como lo guarda Periskope; la importación lo resuelve con /properties.
              custom_properties: i === 0 ? { 'property-fakeplan': 'Pro' } : {},
            })),
          ),
        };
      case '/contacts':
        return {
          contacts: page(
            rows
              .filter((r) => r.kind !== 'group' && r.phone)
              .map((r) => ({ contact_id: `${r.phone}@c.us`, contact_name: r.name, labels: [FAKE_PERISKOPE_CONTACT_LABEL] })),
          ),
        };
      case '/tickets':
        return {
          tickets: page(
            rows.slice(0, 2).map((r, i) => ({
              ticket_id: `FAKE-${tag}-${i + 1}`,
              chat_id: jid(r),
              subject: i === 0 ? 'Imported ticket from Periskope' : 'Closed ticket from Periskope',
              status: i === 0 ? 'inprogress' : 'closed',
              priority: i === 0 ? 3 : 1,
              assignee: owner?.email ?? '',
              quoted_message_id: null,
              created_at: '2026-01-15T09:30:00.000Z',
              closed_at: i === 0 ? null : '2026-01-16T10:00:00.000Z',
              is_deleted: false,
            })),
          ),
        };
      case '/notes':
        return {
          notes: page(
            rows.slice(0, 1).map((r) => ({
              message_id: `true_fake-note-${tag}_api`,
              chat_id: jid(r),
              org_phone: r.number_phone ? `${r.number_phone}@c.us` : null,
              body: 'Private note imported from Periskope',
              timestamp: '2026-01-15T09:35:00.000Z',
              performed_by: owner?.email ?? 'api',
              is_private_note: true,
            })),
          ),
        };
      default: {
        // Historial: mensajes de un chat (del más nuevo al más viejo), reacciones y notas del chat.
        const m = /^\/chats\/([^/]+)\/(messages|notes)$/.exec(url.pathname);
        if (m) {
          const chatId = decodeURIComponent(m[1]);
          const limit = Number(url.searchParams.get('limit') ?? 1000);
          if (m[2] === 'notes') return { notes: [] };
          // 5 mensajes por chat: texto, uno con archivo (el mismo del fake), una respuesta citada y uno ya recibido por WhatsApp.
          const all = fakeHistory(tag, chatId);
          return { count: all.slice(offset, offset + limit).length, messages: all.slice(offset, offset + limit) };
        }
        if (url.pathname === '/reactions') {
          const chatId = url.searchParams.get('chat_id') ?? '';
          return { reactions: offset > 0 ? [] : [{ reaction_id: `r-${tag}`, chat_id: chatId, unique_id: `FAKEWA${tag}1`, sender_id: '5491100000001@c.us', reaction: '👍', timestamp: '2025-03-01T10:05:00.000Z' }] };
        }
        throw new GroupsError('periskope_unavailable', 502);
      }
    }
  };
}

/** Los mensajes simulados de un chat (ids con la clave: otra clave es otra cuenta). */
export function fakeHistory(tag: string, chatId: string) {
  const base = { chat_id: chatId, org_phone: null, performed_by: null, ack: '3' };
  const id = (n: number) => `FAKEWA${tag}${n}`;
  const mid = (n: number, fromMe: boolean) => `${fromMe}_${chatId}_${id(n)}`;
  const grp = chatId.endsWith('@g.us');
  return [
    { ...base, message_id: mid(4, false), unique_id: id(4), from_me: false, sender_phone: grp ? '5491100000002@c.us' : chatId, author: grp ? '5491100000002@c.us' : null, body: 'Fake history reply', message_type: 'chat', timestamp: '2025-03-01T10:03:00.000Z', quoted_message_id: mid(1, false) },
    { ...base, message_id: mid(3, true), unique_id: id(3), from_me: true, sender_phone: '', body: 'Fake history photo caption', message_type: 'image', timestamp: '2025-03-01T10:02:00.000Z', media: { path: `https://api.periskope.app/app/media/fake-${tag}`, mimetype: 'image/png', filename: 'fake.png', size: 70 } },
    { ...base, message_id: mid(2, true), unique_id: id(2), from_me: true, sender_phone: '', body: 'Fake history answer', message_type: 'chat', timestamp: '2025-03-01T10:01:00.000Z' },
    { ...base, message_id: mid(1, false), unique_id: id(1), from_me: false, sender_phone: grp ? '5491100000001@c.us' : chatId, author: grp ? '5491100000001@c.us' : null, body: 'Fake history first message', message_type: 'chat', timestamp: '2025-03-01T10:00:00.000Z' },
  ];
}

/** El archivo simulado: un PNG de 1x1. */
export function fakePeriskopeMedia(key: string): PeriskopeMediaFetch {
  return async (url) => {
    if (/invalid/i.test(key) || !/fake-/.test(url)) return null;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    return { data: png, mimetype: 'image/png', filename: 'fake.png' };
  };
}
