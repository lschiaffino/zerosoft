import type { Client } from '@libsql/client';
import type { Migration } from '../migrations';

/**
 * Stickers de WhatsApp por línea (lib/wa-stickers.ts). Hasta ahora la colección
 * era una por persona y por app, con los stickers de todas sus líneas juntos:
 * en el chat de una línea aparecían los de otra.
 *
 * - `wa_stickers.line_id`: la línea del sticker (Lines: groups_numbers.id;
 *   Inbox: inbox_accounts.id). '' = de antes de esta regla y sin ubicar.
 * - El único pasa a ser por línea: el mismo archivo puede estar en dos líneas.
 *   El único anterior (por persona) se saca; es un índice, no datos.
 * - `wa_sticker_line_sync`: hasta dónde se trajo de los chats de cada línea
 *   (wa_sticker_sync, la marca por persona, queda como estaba y sin uso).
 * - Lo que ya estaba: cada sticker importado de los chats se ubica en la línea
 *   donde un mensaje trae su SHA-256 (attributeStickerLines). No se borra ni
 *   se copia nada: solo se completa `line_id`. Los que no se pueden ubicar
 *   quedan con '' y los resuelve lib/wa-stickers.ts (los creados y favoritos
 *   se ven en todas las líneas de la persona; los importados pasan a la línea
 *   donde reaparezcan al traer los stickers de sus chats).
 *
 * Idempotente y tolera correr en paralelo: columna con addColumn, IF NOT
 * EXISTS, y la ubicación solo toca filas con line_id = '' (UPDATE OR IGNORE).
 */
async function addColumn(c: Client, sql: string): Promise<void> {
  try {
    await c.execute(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}

/**
 * Ubica en su línea los stickers importados que todavía no tienen una: la
 * línea de un mensaje (de ese workspace en Lines, de esa persona en Inbox) con
 * el mismo SHA-256. Si aparece en más de una, va a la primera por id (las
 * otras lo vuelven a traer de sus propios chats). Una lectura de mensajes por
 * workspace o persona, sobre el índice parcial de stickers. Devuelve cuántos ubicó.
 */
export async function attributeStickerLines(c: Pick<Client, 'execute'>): Promise<number> {
  const pending = (
    await c.execute("SELECT id, app, user_id, scope_id, hash FROM wa_stickers WHERE line_id = '' AND source = 'chat' AND app IN ('lines', 'inbox')")
  ).rows as unknown as Array<{ id: string; app: string; user_id: string; scope_id: string; hash: string }>;
  if (pending.length === 0) return 0;
  const cache = new Map<string, Map<string, string>>();
  const linesOf = async (app: string, key: string): Promise<Map<string, string>> => {
    const k = `${app}|${key}`;
    const hit = cache.get(k);
    if (hit) return hit;
    const res =
      app === 'lines'
        ? await c.execute({
            sql: `SELECT number_id AS line, CASE WHEN json_valid(meta) THEN json_extract(meta, '$.media.sha') END AS sha
                    FROM groups_messages WHERE user_id = ? AND media_type = 'image/webp' AND deleted_at IS NULL
                   GROUP BY 1, 2`,
            args: [key],
          })
        : await c.execute({
            sql: `SELECT t.account_id AS line, CASE WHEN json_valid(m.meta) THEN json_extract(m.meta, '$.sha') END AS sha
                    FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
                   WHERE m.owner_id = ? AND m.media_type = 'sticker'
                   GROUP BY 1, 2`,
            args: [key],
          });
    const map = new Map<string, string>();
    for (const r of res.rows as unknown as Array<{ line: string | null; sha: string | null }>) {
      if (!r.line || typeof r.sha !== 'string' || !r.sha) continue;
      const line = String(r.line);
      const prev = map.get(r.sha);
      if (!prev || line < prev) map.set(r.sha, line);
    }
    cache.set(k, map);
    return map;
  };
  let done = 0;
  for (const row of pending) {
    const line = (await linesOf(row.app, row.app === 'lines' ? row.scope_id : row.user_id)).get(row.hash);
    if (!line) continue;
    const r = await c.execute({ sql: "UPDATE OR IGNORE wa_stickers SET line_id = ? WHERE id = ? AND line_id = ''", args: [line, row.id] });
    done += Number(r.rowsAffected ?? 0);
  }
  return done;
}

export default {
  id: '20261119_1525_wa_stickers_per_line',
  up: async (c) => {
    await addColumn(c, "ALTER TABLE wa_stickers ADD COLUMN line_id TEXT NOT NULL DEFAULT ''");
    await c.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_stickers_line_hash ON wa_stickers(user_id, app, scope_id, line_id, hash)');
    await c.execute('DROP INDEX IF EXISTS idx_wa_stickers_hash');
    await c.execute(`
      CREATE TABLE IF NOT EXISTS wa_sticker_line_sync (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        app TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        line_id TEXT NOT NULL DEFAULT '',
        cursor INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, app, scope_id, line_id)
      )`);
    await attributeStickerLines(c);
  },
} satisfies Migration;
