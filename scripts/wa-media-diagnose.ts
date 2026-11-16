/**
 * Diagnóstico de los archivos de WhatsApp (Inbox y Lines): cuenta, por cuenta
 * y por línea, en qué estado quedó cada archivo de los últimos N días. Solo
 * lee, y solo imprime cantidades: nunca ids de WhatsApp, números, nombres ni
 * contenido (las cuentas salen con los primeros 6 caracteres de su id).
 *
 * Inbox (los archivos se piden al servidor de WhatsApp al verlos):
 *   - con_clave: la referencia tiene la clave del archivo. Se puede volver a
 *     bajar de WhatsApp (o pedírselo al teléfono) aunque la línea se haya
 *     vuelto a vincular.
 *   - solo_mensaje: la referencia es solo el id del mensaje. Depende de que el
 *     servidor de WhatsApp todavía tenga ese mensaje; después de volver a
 *     vincular la línea, no lo tiene.
 *   - sin_referencia: no se puede pedir (ver una vez, más grande que el tope,
 *     o enviado sin id).
 *   - transcripciones que fallaron porque el audio no estaba.
 *   - mensajes repetidos en dos chats de la misma cuenta (el del teléfono y el
 *     del id anónimo).
 * Lines (los archivos se guardan al llegar):
 *   - guardado (local, store público, store privado), en_el_proveedor,
 *     pendiente (todavía no se bajó), ya_no_esta (WhatsApp no lo tiene),
 *     sin_archivo con clave (se puede volver a pedir) y sin clave.
 *
 * Uso (con las variables de producción en .env.production.local):
 *   npx tsx --env-file=.env.production.local scripts/wa-media-diagnose.ts --days 30
 * Opciones: --days N (30, hasta 365), --json (una línea JSON por cuenta),
 *   --probe N: además, en Inbox, pide de verdad hasta N archivos por cuenta
 *   (los más nuevos de cada clase) y cuenta qué responde el servidor:
 *   ok, ya_no_esta, desconectada o pasajera. No guarda nada.
 */
import { getDb } from '../lib/db';

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const short = (id: string) => `${String(id).slice(0, 6)}…`;

type Counts = Record<string, number>;

async function inbox(sinceIso: string, probe: number): Promise<Array<{ account: string; status: string; counts: Counts }>> {
  const db = getDb();
  const accounts = (await db.prepare("SELECT id, owner_id, status, provider FROM inbox_accounts WHERE kind = 'whatsapp'").all()) as Array<{ id: string; owner_id: string; status: string; provider: string }>;
  const out: Array<{ account: string; status: string; counts: Counts }> = [];
  for (const a of accounts) {
    const rows = (await db
      .prepare(
        `SELECT m.media_type AS kind,
                CASE WHEN m.media_ref = '' THEN 'sin_referencia' WHEN m.media_ref LIKE '%"wire"%' THEN 'con_clave' ELSE 'solo_mensaje' END AS state,
                COUNT(*) AS n
         FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
         WHERE t.account_id = ? AND m.media_type <> '' AND m.sent_at >= ? GROUP BY 1, 2`,
      )
      .all(a.id, sinceIso)) as Array<{ kind: string; state: string; n: number }>;
    const counts: Counts = {};
    for (const r of rows) {
      counts[`${r.state}.${r.kind}`] = Number(r.n);
      counts[r.state] = (counts[r.state] ?? 0) + Number(r.n);
      counts.total = (counts.total ?? 0) + Number(r.n);
    }
    const failed = (await db
      .prepare(
        `SELECT COUNT(*) AS n FROM wa_transcripts w JOIN inbox_messages m ON m.id = w.message_id JOIN inbox_threads t ON t.id = m.thread_id
         WHERE w.scope = 'inbox' AND w.owner_id = ? AND t.account_id = ? AND w.status = 'failed' AND w.error = 'media_unavailable' AND m.sent_at >= ?`,
      )
      .get(a.owner_id, a.id, sinceIso)) as { n: number } | undefined;
    counts.transcripcion_sin_audio = Number(failed?.n ?? 0);
    const twins = (await db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT m.external_id FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
           WHERE t.account_id = ? AND m.sent_at >= ? AND m.external_id <> '' AND m.external_id NOT LIKE 'local-%' GROUP BY m.external_id HAVING COUNT(*) > 1)`,
      )
      .get(a.id, sinceIso)) as { n: number } | undefined;
    counts.repetidos_en_dos_chats = Number(twins?.n ?? 0);

    if (probe > 0 && a.provider) {
      const { fetchWhatsappMedia } = await import('../lib/inbox/whatsapp');
      const { getAccountById } = await import('../lib/inbox/core');
      const account = await getAccountById(a.id);
      for (const state of ['con_clave', 'solo_mensaje'] as const) {
        const sample = (await db
          .prepare(
            `SELECT m.media_ref FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
             WHERE t.account_id = ? AND m.media_type <> '' AND m.media_ref <> '' AND m.sent_at >= ?
               AND (m.media_ref LIKE '%"wire"%') = ? ORDER BY m.sent_at DESC LIMIT ?`,
          )
          .all(a.id, sinceIso, state === 'con_clave' ? 1 : 0, probe)) as Array<{ media_ref: string }>;
        for (const s of sample) {
          let result = 'ok';
          try {
            if (!account) throw Object.assign(new Error('x'), { status: 409 });
            await fetchWhatsappMedia(account, s.media_ref);
          } catch (err) {
            const status = (err as { status?: number })?.status;
            result = status === 410 ? 'ya_no_esta' : status === 409 ? 'desconectada' : 'pasajera';
          }
          counts[`prueba.${state}.${result}`] = (counts[`prueba.${state}.${result}`] ?? 0) + 1;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
    out.push({ account: short(a.id), status: a.status || 'sin_vincular', counts });
  }
  return out;
}

async function lines(sinceSql: string): Promise<Array<{ account: string; status: string; counts: Counts }>> {
  const db = getDb();
  const numbers = (await db.prepare('SELECT id, status, provider FROM groups_numbers').all()) as Array<{ id: string; status: string; provider: string }>;
  const out: Array<{ account: string; status: string; counts: Counts }> = [];
  for (const n of numbers) {
    const rows = (await db
      .prepare(
        `SELECT
           CASE
             WHEN m.media_url LIKE 'evo:%' THEN 'pendiente'
             WHEN m.media_url LIKE 'meta:%' OR m.media_url LIKE 'bridge:%' THEN 'en_el_proveedor'
             WHEN m.media_url LIKE '/api/files/%' THEN 'guardado.privado'
             WHEN m.media_url LIKE '/uploads/%' THEN 'guardado.local'
             WHEN m.media_url LIKE 'https://%' THEN 'guardado.publico'
             WHEN m.media_url = '' AND COALESCE(json_extract(CASE WHEN json_valid(m.meta) THEN m.meta ELSE '{}' END, '$.media.viewOnce'), 0) = 1 THEN 'ver_una_vez'
             WHEN m.media_url = '' AND COALESCE(json_extract(CASE WHEN json_valid(m.meta) THEN m.meta ELSE '{}' END, '$.mediaGone'), 0) = 1 THEN 'ya_no_esta'
             WHEN m.media_url = '' AND json_extract(CASE WHEN json_valid(m.meta) THEN m.meta ELSE '{}' END, '$.mediaWire') IS NOT NULL THEN 'sin_archivo.con_clave'
             WHEN m.media_url = '' THEN 'sin_archivo.sin_clave'
             ELSE 'otro'
           END AS state,
           m.direction AS dir, COUNT(*) AS n
         FROM groups_messages m
         WHERE m.number_id = ? AND m.media_type <> '' AND m.created_at >= ? GROUP BY 1, 2`,
      )
      .all(n.id, sinceSql)) as Array<{ state: string; dir: string; n: number }>;
    const counts: Counts = {};
    for (const r of rows) {
      counts[r.state] = (counts[r.state] ?? 0) + Number(r.n);
      counts[`${r.state}.${r.dir === 'out' ? 'enviado' : 'recibido'}`] = Number(r.n);
      counts.total = (counts.total ?? 0) + Number(r.n);
    }
    const failed = (await db
      .prepare(
        `SELECT COUNT(*) AS n FROM wa_transcripts w JOIN groups_messages m ON m.id = w.message_id
         WHERE w.scope = 'lines' AND m.number_id = ? AND w.status = 'failed' AND w.error = 'media_unavailable' AND m.created_at >= ?`,
      )
      .get(n.id, sinceSql)) as { n: number } | undefined;
    counts.transcripcion_sin_audio = Number(failed?.n ?? 0);
    out.push({ account: `${short(n.id)} (${n.provider})`, status: n.status, counts });
  }
  return out;
}

function print(app: string, rows: Array<{ account: string; status: string; counts: Counts }>, json: boolean) {
  for (const r of rows) {
    if (json) {
      console.log(JSON.stringify({ app, ...r }));
      continue;
    }
    console.log(`\n[${app}] ${r.account} · ${r.status} · ${r.counts.total ?? 0} archivos`);
    for (const [k, v] of Object.entries(r.counts).sort(([a], [b]) => a.localeCompare(b))) {
      if (k !== 'total' && v > 0) console.log(`  ${k.padEnd(34)} ${v}`);
    }
  }
}

async function main() {
  const days = Math.max(1, Math.min(365, Number(arg('days', '30')) || 30));
  const probe = Math.max(0, Math.min(50, Number(arg('probe', '0')) || 0));
  const json = flag('json');
  const since = new Date(Date.now() - days * 86_400_000);
  if (!json) console.log(`Archivos de WhatsApp de los últimos ${days} días (solo cantidades).${probe ? ` Prueba: hasta ${probe} por clase y cuenta.` : ''}`);
  print('inbox', await inbox(since.toISOString(), probe), json);
  print('lines', await lines(since.toISOString().replace('T', ' ').slice(0, 19)), json);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[diagnose] falló', (err as Error)?.name ?? 'error');
    process.exit(1);
  },
);
