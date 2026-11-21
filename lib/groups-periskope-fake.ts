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
    const rows = (await db
      .prepare(
        `SELECT c.provider_chat_id, c.kind, c.name, c.phone, n.phone AS number_phone FROM groups_chats c LEFT JOIN groups_numbers n ON n.id = c.number_id
         WHERE c.user_id = ? AND c.provider_chat_id != '' ORDER BY c.created_at, c.id LIMIT 4`,
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
      default:
        throw new GroupsError('periskope_unavailable', 502);
    }
  };
}
