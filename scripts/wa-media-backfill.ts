/**
 * Vuelve a bajar las fotos y videos de WhatsApp que quedaron "No disponible"
 * en Lines en los últimos N días (por número). Sin --apply solo cuenta
 * (dry-run). Con la clave del archivo guardada, Evolution lo baja de WhatsApp
 * y, si el enlace venció, le pide al teléfono que lo vuelva a subir.
 *
 * Inbox no guarda los archivos (los baja al mostrarlos): para Inbox solo
 * informa cuántos tienen clave (se pueden volver a bajar al abrirlos) y
 * cuántos no (los que llegaron por el historial antes de este cambio).
 *
 * Uso (con las variables de producción en .env.production.local):
 *   npx tsx --env-file=.env.production.local scripts/wa-media-backfill.ts --days 3
 *   npx tsx --env-file=.env.production.local scripts/wa-media-backfill.ts --days 3 --apply
 * Opciones: --days N (3), --number <id de número de Lines>, --include-gone, --limit N (200).
 *
 * El log lleva solo cantidades y tipos de falla: nunca ids de WhatsApp,
 * números ni contenido.
 */
import { getDb } from '../lib/db';
import { getChatRow, getNumberRowById, retryInboundMedia, type MessageRow } from '../lib/groups';

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const days = Math.max(1, Math.min(60, Number(arg('days', '3')) || 3));
  const limit = Math.max(1, Math.min(5000, Number(arg('limit', '200')) || 200));
  const apply = flag('apply');
  const includeGone = flag('include-gone');
  const onlyNumber = arg('number');
  const since = new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  const db = getDb();

  const rows = (await db
    .prepare(
      `SELECT m.* FROM groups_messages m JOIN groups_numbers n ON n.id = m.number_id
       WHERE m.media_url = '' AND m.provider_message_id IS NOT NULL AND m.deleted_at IS NULL
         AND (m.media_type LIKE 'image/%' OR m.media_type LIKE 'video/%' OR m.media_type IN ('image', 'video'))
         AND m.created_at >= ? AND n.provider IN ('evolution', 'managed')
         ${onlyNumber ? 'AND m.number_id = ?' : ''}
         ${includeGone ? '' : "AND COALESCE(json_extract(CASE WHEN json_valid(m.meta) THEN m.meta ELSE '{}' END, '$.mediaGone'), 0) = 0"}
       ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(...(onlyNumber ? [since, onlyNumber, limit] : [since, limit]))) as Array<MessageRow & { meta: string }>;

  const byNumber = new Map<string, MessageRow[]>();
  for (const r of rows) byNumber.set(r.number_id, [...(byNumber.get(r.number_id) ?? []), r]);
  const withWire = rows.filter((r) => /"mediaWire"/.test(r.meta ?? '')).length;
  console.log(`[lines] ${rows.length} sin archivo en ${days} días (${withWire} con clave), ${byNumber.size} números. ${apply ? 'Reintentando…' : 'Dry-run: agregá --apply para reintentar.'}`);

  if (apply) {
    const tally = { ok: 0, gone: 0, pending: 0 };
    for (const [numberId, list] of byNumber) {
      const number = await getNumberRowById(numberId);
      if (!number) continue;
      const local = { ok: 0, gone: 0, pending: 0 };
      for (const msg of list) {
        const chat = await getChatRow(number.user_id, msg.chat_id);
        if (!chat) continue;
        const r = await retryInboundMedia(number, msg, chat.provider_chat_id);
        const k = 'url' in r ? 'ok' : 'gone' in r ? 'gone' : 'pending';
        local[k]++;
        tally[k]++;
        // Sin apurar al gateway ni al teléfono.
        await new Promise((res) => setTimeout(res, 400));
      }
      console.log(`[lines] número ${numberId.slice(0, 6)}…: ${local.ok} bajadas, ${local.gone} ya no están en WhatsApp, ${local.pending} para más tarde`);
    }
    console.log(`[lines] total: ${tally.ok} bajadas, ${tally.gone} ya no están, ${tally.pending} para más tarde`);
  }

  const inbox = (await db
    .prepare(
      `SELECT CASE WHEN media_ref LIKE '%"wire"%' THEN 1 ELSE 0 END AS wire, COUNT(*) AS n FROM inbox_messages
       WHERE media_ref <> '' AND media_type IN ('image', 'video') AND sent_at >= ? GROUP BY 1`,
    )
    .all(new Date(Date.now() - days * 86_400_000).toISOString())) as Array<{ wire: number; n: number }>;
  const count = (w: number) => Number(inbox.find((r) => Number(r.wire) === w)?.n ?? 0);
  console.log(`[inbox] fotos y videos de ${days} días: ${count(1)} con clave (se vuelven a bajar al abrirlos), ${count(0)} sin clave (dependen de que el gateway tenga el mensaje).`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[backfill] falló', (err as Error)?.name ?? 'error');
    process.exit(1);
  },
);
