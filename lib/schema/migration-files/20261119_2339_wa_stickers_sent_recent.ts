import type { Client } from '@libsql/client';
import type { Migration } from '../migrations';

/**
 * Stickers de WhatsApp: lo suyo primero (lib/wa-stickers.ts). La pestaña
 * muestra arriba los recientes, que ahora son los que la persona mandó desde
 * esa línea también desde el teléfono, no solo desde zerosoft. Para las
 * colecciones nuevas lo arma la importación de los chats (los mensajes propios
 * llevan `sentAt`); esta migración completa las que ya estaban importadas, cuyo
 * cursor ya pasó esos mensajes.
 *
 * Sin columnas nuevas: `wa_stickers.last_used_at` ya es "la última vez que lo
 * mandó". Se adelanta a la fecha del último mensaje propio de esa línea con el
 * mismo SHA-256 (solo avanza):
 * - Inbox: mensajes con from_me = 1 en un chat de esa cuenta, de esa persona.
 * - Lines: mensajes que salieron de esa línea escritos por esa persona en
 *   zerosoft. Los mandados desde el teléfono solo para quien es dueño del
 *   workspace (ve todos los chats): para un miembro, que puede no ver algunos
 *   chats, los suma la importación, que filtra por los chats que ve.
 *
 * Idempotente y tolera correr en paralelo: solo adelanta la fecha.
 */

/** Una fecha de la base (ISO o 'YYYY-MM-DD HH:MM:SS' en UTC) en ISO. */
function iso(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const d = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const later = (a: string | undefined, b: string | null) => (b && (!a || b > a) ? b : a);

/** Completa los recientes de las colecciones ya importadas. Devuelve cuántos stickers adelantó. */
export async function backfillSentStickers(c: Pick<Client, 'execute'>): Promise<number> {
  const rows = (
    await c.execute("SELECT id, app, user_id, scope_id, line_id, hash, last_used_at FROM wa_stickers WHERE line_id <> '' AND app IN ('lines', 'inbox')")
  ).rows as unknown as Array<{ id: string; app: string; user_id: string; scope_id: string; line_id: string; hash: string; last_used_at: string | null }>;
  if (rows.length === 0) return 0;
  // Por workspace (Lines) o persona (Inbox), una lectura: `${línea}|${sha}|${quién}` → el último envío.
  const cache = new Map<string, Map<string, string>>();
  const sentOf = async (app: string, key: string): Promise<Map<string, string>> => {
    const k = `${app}|${key}`;
    const hit = cache.get(k);
    if (hit) return hit;
    const map = new Map<string, string>();
    if (app === 'lines') {
      const res = await c.execute({
        sql: `SELECT number_id AS line, CASE WHEN json_valid(meta) THEN json_extract(meta, '$.media.sha') END AS sha,
                     CASE WHEN author_kind = 'phone' THEN '' ELSE author_id END AS who, MAX(created_at) AS at
                FROM groups_messages
               WHERE user_id = ? AND media_type = 'image/webp' AND direction = 'out' AND deleted_at IS NULL
                 AND (author_kind = 'phone' OR (author_kind = 'person' AND author_id IS NOT NULL))
               GROUP BY 1, 2, 3`,
        args: [key],
      });
      for (const r of res.rows as unknown as Array<{ line: string; sha: unknown; who: string | null; at: unknown }>) {
        if (typeof r.sha !== 'string' || !r.sha) continue;
        const id = `${r.line}|${r.sha}|${r.who ?? ''}`;
        const at = later(map.get(id), iso(r.at));
        if (at) map.set(id, at);
      }
    } else {
      const res = await c.execute({
        sql: `SELECT t.account_id AS line, CASE WHEN json_valid(m.meta) THEN json_extract(m.meta, '$.sha') END AS sha, MAX(m.sent_at) AS at
                FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
               WHERE m.owner_id = ? AND m.media_type = 'sticker' AND m.from_me = 1 AND m.revoked_at IS NULL
               GROUP BY 1, 2`,
        args: [key],
      });
      for (const r of res.rows as unknown as Array<{ line: string; sha: unknown; at: unknown }>) {
        if (typeof r.sha !== 'string' || !r.sha) continue;
        const id = `${r.line}|${r.sha}|`;
        const at = later(map.get(id), iso(r.at));
        if (at) map.set(id, at);
      }
    }
    cache.set(k, map);
    return map;
  };
  let done = 0;
  for (const row of rows) {
    let at: string | undefined;
    if (row.app === 'lines') {
      const sent = await sentOf('lines', row.scope_id);
      at = sent.get(`${row.line_id}|${row.hash}|${row.user_id}`);
      // Desde el teléfono: solo para el dueño del workspace (el id del workspace es el de su dueño).
      if (row.user_id === row.scope_id) at = later(at, sent.get(`${row.line_id}|${row.hash}|`) ?? null);
    } else {
      at = (await sentOf('inbox', row.user_id)).get(`${row.line_id}|${row.hash}|`);
    }
    if (!at || (row.last_used_at && iso(row.last_used_at)! >= at)) continue;
    const r = await c.execute({
      sql: 'UPDATE wa_stickers SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)',
      args: [at, row.id, at],
    });
    done += Number(r.rowsAffected ?? 0);
  }
  return done;
}

export default {
  id: '20261119_2339_wa_stickers_sent_recent',
  up: async (c) => {
    await backfillSentStickers(c);
  },
} satisfies Migration;
