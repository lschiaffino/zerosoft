import type { Client } from '@libsql/client';
import UAParser from 'ua-parser-js';

async function addColumn(client: Client, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}

/**
 * Rec: de dónde y con qué se vio cada vista (país, región, ciudad, dispositivo,
 * navegador, sistema y dominio de origen), las re-vistas por tramo (`heat`) y el
 * número de espectador estable ("Espectador 3"). Lo ya guardado se reduce a eso:
 * el user agent completo pasa a dispositivo/navegador/sistema y se borra, y el
 * hash de la IP también. Idempotente y en tandas (puede cortarse y seguir).
 */
export async function recViewContextUp(c: Client): Promise<void> {
  for (const col of ['country', 'region', 'city', 'device', 'browser', 'os', 'referrer']) {
    await addColumn(c, `ALTER TABLE rec_views ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  }
  await addColumn(c, 'ALTER TABLE rec_views ADD COLUMN heat TEXT');
  await addColumn(c, 'ALTER TABLE rec_views ADD COLUMN viewer_no INTEGER');
  await c.execute('CREATE INDEX IF NOT EXISTS idx_rec_views_no ON rec_views(video_id, viewer_no)');

  // User agent → dispositivo, navegador y sistema; después se borra.
  for (;;) {
    const rows = (await c.execute("SELECT id, user_agent FROM rec_views WHERE user_agent != '' LIMIT 500")).rows;
    if (!rows.length) break;
    const stmts = rows.map((r) => {
      const ua = new UAParser(String(r.user_agent)).getResult();
      const t = ua.device.type;
      return {
        sql: "UPDATE rec_views SET device = CASE WHEN device = '' THEN ? ELSE device END, browser = CASE WHEN browser = '' THEN ? ELSE browser END, os = CASE WHEN os = '' THEN ? ELSE os END, user_agent = '' WHERE id = ?",
        args: [t === 'mobile' || t === 'tablet' ? t : 'desktop', (ua.browser.name ?? '').slice(0, 40), (ua.os.name ?? '').slice(0, 40), String(r.id)],
      };
    });
    await c.batch(stmts, 'write');
  }
  await c.execute("UPDATE rec_views SET ip_hash = '' WHERE ip_hash != ''");

  // Número de espectador por video, por orden de llegada.
  const videos = (await c.execute('SELECT DISTINCT video_id FROM rec_views WHERE viewer_no IS NULL')).rows.map((r) => String(r.video_id));
  for (const videoId of videos) {
    const keys = (
      await c.execute({
        sql: 'SELECT viewer_key, MIN(started_at) AS f FROM rec_views WHERE video_id = ? GROUP BY viewer_key ORDER BY f, viewer_key',
        args: [videoId],
      })
    ).rows.map((r) => String(r.viewer_key));
    const stmts = keys.map((k, i) => ({
      sql: 'UPDATE rec_views SET viewer_no = ? WHERE video_id = ? AND viewer_key = ? AND viewer_no IS NULL',
      args: [i + 1, videoId, k],
    }));
    for (let i = 0; i < stmts.length; i += 200) await c.batch(stmts.slice(i, i + 200), 'write');
  }
}
