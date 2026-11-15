/**
 * Inbox: la copia propia de los archivos de WhatsApp (fotos, audios, videos,
 * documentos, stickers). El archivo se baja del servidor de WhatsApp una vez
 * (al llegar, por la cola de lib/wa-media-jobs.ts, o la primera vez que se
 * pide) y queda guardado privado y cifrado (lib/private-files.ts): no tiene
 * URL pública y solo lo sirve la ruta de Inbox, a su dueña. Desde ahí no
 * depende de que el servidor de WhatsApp siga teniendo el mensaje ni de que
 * la línea esté vinculada. Server-only.
 *
 * Dónde: el store privado INBOX_MEDIA_BLOB_READ_WRITE_TOKEN si está; si no,
 * cifrado en el store de la suite; en self-host, cifrado en disco.
 */
import { getDb } from '../db';
import { privateFileStore } from '../private-files';
import type { AccountRow } from './core';
import { InboxError } from './types';
import { fetchWhatsappMedia } from './whatsapp';

const files = privateFileStore({
  folder: 'inbox-media',
  envPrefix: 'INBOX_MEDIA',
  hkdfLabel: 'inbox-media-files',
  magic: 'ZSI1',
  unavailable: () => new InboxError('storage_unavailable', 503),
});

export interface MediaFile {
  data: Buffer;
  mimetype: string;
  filename: string;
}

interface FileRow {
  message_id: string;
  owner_id: string;
  file_ref: string;
  mime: string;
  filename: string;
  size: number;
}

/** ¿Ya está guardado? (sin leer los bytes). */
export async function hasStoredMedia(owner: string, messageId: string): Promise<boolean> {
  return !!(await getDb().prepare('SELECT 1 AS ok FROM inbox_media_files WHERE message_id = ? AND owner_id = ?').get(messageId, owner));
}

/** La copia guardada del archivo de un mensaje, o null si no hay (o no se pudo leer). */
export async function readStoredMedia(owner: string, messageId: string): Promise<MediaFile | null> {
  const row = (await getDb().prepare('SELECT * FROM inbox_media_files WHERE message_id = ? AND owner_id = ?').get(messageId, owner)) as FileRow | undefined;
  if (!row) return null;
  const data = await files.read(row.file_ref);
  if (!data) {
    // El archivo no está o no se puede abrir: la fila no sirve; se vuelve a bajar.
    await getDb().prepare('DELETE FROM inbox_media_files WHERE message_id = ? AND file_ref = ?').run(messageId, row.file_ref);
    await files.removeOne(row.file_ref).catch(() => false);
    return null;
  }
  return { data, mimetype: row.mime || 'application/octet-stream', filename: row.filename };
}

/** Guarda la copia (una por mensaje: si otro pedido la guardó primero, la de más se borra). */
export async function storeMedia(owner: string, messageId: string, file: MediaFile): Promise<boolean> {
  const mime = (file.mimetype || 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 100);
  const ref = await files.store(file.data, mime);
  const r = await getDb()
    .prepare(
      `INSERT INTO inbox_media_files (message_id, owner_id, file_ref, mime, filename, size, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM inbox_messages m WHERE m.id = ? AND m.owner_id = ?)
       ON CONFLICT (message_id) DO NOTHING`,
    )
    .run(messageId, owner, ref, mime, (file.filename || '').slice(0, 300), file.data.length, new Date().toISOString(), messageId, owner);
  if (r.changes === 0) {
    await files.removeOne(ref).catch(() => false);
    return false;
  }
  return true;
}

/**
 * El archivo de un mensaje: la copia guardada si está; si no, se baja del
 * servidor de WhatsApp (con los mismos errores que fetchWhatsappMedia:
 * media_gone 410, not_connected 409, media_unavailable 502) y se guarda. Que
 * no se pueda guardar no impide mostrarlo.
 */
export async function inboxMedia(account: AccountRow, owner: string, msg: { id: string; media_ref: string }): Promise<MediaFile> {
  const stored = await readStoredMedia(owner, msg.id).catch(() => null);
  if (stored) return stored;
  const file = await fetchWhatsappMedia(account, msg.media_ref);
  await storeMedia(owner, msg.id, file).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[inbox-media] store failed', (err as Error)?.name ?? 'error');
    return false;
  });
  return file;
}

/**
 * Copias cuyo mensaje ya no existe (se borró el mensaje, el chat o la cuenta
 * por cualquier camino) o se borró para todos: se borra el archivo y la fila. Corre desde el cron
 * horario; cada fila se borra primero (así dos corridas no borran lo mismo).
 */
export async function sweepOrphanMedia(limit = 200): Promise<number> {
  const db = getDb();
  const rows = (await db
    .prepare('SELECT f.message_id, f.file_ref FROM inbox_media_files f WHERE NOT EXISTS (SELECT 1 FROM inbox_messages m WHERE m.id = f.message_id AND m.revoked_at IS NULL) LIMIT ?')
    .all(limit)) as Array<{ message_id: string; file_ref: string }>;
  let n = 0;
  for (const r of rows) {
    const gone = await db
      .prepare('DELETE FROM inbox_media_files WHERE message_id = ? AND file_ref = ? AND NOT EXISTS (SELECT 1 FROM inbox_messages m WHERE m.id = inbox_media_files.message_id AND m.revoked_at IS NULL)')
      .run(r.message_id, r.file_ref);
    if (gone.changes === 0) continue;
    await files.removeOne(r.file_ref).catch(() => false);
    n++;
  }
  return n;
}
