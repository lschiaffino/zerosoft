/**
 * Inbox: la copia propia de los archivos de WhatsApp (fotos, audios, videos,
 * documentos, stickers). El archivo se baja del servidor de WhatsApp una vez
 * (al llegar, por la cola de lib/wa-media-jobs.ts, o la primera vez que se
 * pide) y queda guardado privado (lib/private-files.ts): no tiene URL pública
 * y solo lo sirve la ruta de Inbox, a su dueña. Desde ahí no depende de que
 * el servidor de WhatsApp siga teniendo el mensaje ni de que la línea esté
 * vinculada. Server-only.
 *
 * Dónde: el store privado INBOX_MEDIA_BLOB_READ_WRITE_TOKEN si está; si no,
 * cifrado en el store de la suite; en self-host, cifrado en disco. La clave
 * de lo cifrado es INBOX_MEDIA_FILES_KEY (o una derivada de ENCRYPTION_KEY);
 * al rotarla, la anterior va en INBOX_MEDIA_FILES_KEY_OLD.
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

/**
 * Tope de lo guardado por persona (bytes). Pasado el tope no se guardan copias nuevas: el archivo se sigue viendo,
 * pidiéndolo al servidor de WhatsApp como antes. Evita que quien manda muchos archivos haga crecer el storage sin fin.
 */
export function ownerStorageCap(): number {
  const mb = Number(process.env.INBOX_MEDIA_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 10 * 1024) * 1024 * 1024;
}

/** ¿Ya está guardado? (sin leer los bytes). */
export async function hasStoredMedia(owner: string, messageId: string): Promise<boolean> {
  return !!(await getDb().prepare('SELECT 1 AS ok FROM inbox_media_files WHERE message_id = ? AND owner_id = ?').get(messageId, owner));
}

/**
 * La copia guardada del archivo de un mensaje, o null si no hay o no se pudo leer ahora. Que no se pueda leer (la
 * red, una clave que falta) no borra nada: la copia puede volver a leerse después.
 */
export async function readStoredMedia(owner: string, messageId: string): Promise<MediaFile | null> {
  const row = (await getDb().prepare('SELECT * FROM inbox_media_files WHERE message_id = ? AND owner_id = ?').get(messageId, owner)) as FileRow | undefined;
  if (!row) return null;
  const data = await files.read(row.file_ref);
  if (!data) return null;
  return { data, mimetype: row.mime || 'application/octet-stream', filename: row.filename };
}

/**
 * Guarda la copia (una por mensaje). Si ya había una fila: con `replace` (la copia anterior no se pudo leer y el
 * archivo se acaba de bajar de nuevo) la fila pasa a la copia nueva y la vieja se borra; sin `replace`, la de más se
 * borra. Devuelve si quedó guardada esta.
 */
export async function storeMedia(owner: string, messageId: string, file: MediaFile, opts: { replace?: boolean } = {}): Promise<boolean> {
  const db = getDb();
  const used = (await db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM inbox_media_files WHERE owner_id = ?').get(owner)) as { n: number } | undefined;
  if (Number(used?.n ?? 0) + file.data.length > ownerStorageCap()) return false;
  const mime = (file.mimetype || 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 100);
  const name = (file.filename || '').slice(0, 300);
  const ref = await files.store(file.data, mime);
  try {
    const r = await db
      .prepare(
        `INSERT INTO inbox_media_files (message_id, owner_id, file_ref, mime, filename, size, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM inbox_messages m WHERE m.id = ? AND m.owner_id = ?)
         ON CONFLICT (message_id) DO NOTHING`,
      )
      .run(messageId, owner, ref, mime, name, file.data.length, new Date().toISOString(), messageId, owner);
    if (r.changes > 0) {
      // Ya está guardado: no hace falta que la cola lo baje.
      await db.prepare("DELETE FROM wa_media_jobs WHERE app = 'inbox' AND message_id = ?").run(messageId).catch(() => null);
      return true;
    }
    if (opts.replace) {
      const old = (await db.prepare('SELECT file_ref FROM inbox_media_files WHERE message_id = ? AND owner_id = ?').get(messageId, owner)) as { file_ref: string } | undefined;
      if (old) {
        const u = await db
          .prepare('UPDATE inbox_media_files SET file_ref = ?, mime = ?, filename = ?, size = ? WHERE message_id = ? AND owner_id = ? AND file_ref = ?')
          .run(ref, mime, name, file.data.length, messageId, owner, old.file_ref);
        if (u.changes > 0) {
          await files.removeOne(old.file_ref).catch(() => false);
          return true;
        }
      }
    }
  } catch (err) {
    // La fila no quedó: el archivo recién subido no se deja suelto.
    await files.removeOne(ref).catch(() => false);
    throw err;
  }
  await files.removeOne(ref).catch(() => false);
  return false;
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
  // Había una fila pero no se pudo leer: la copia nueva la reemplaza.
  await storeMedia(owner, msg.id, file, { replace: true }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[inbox-media] store failed', (err as Error)?.name ?? 'error');
    return false;
  });
  return file;
}

/** Borra archivos por su referencia (el borrado de una cuenta, lib/privacy.ts). */
export async function deleteInboxMediaFiles(refs: string[]): Promise<void> {
  await files.remove(refs);
}

/**
 * Copias cuyo mensaje ya no existe (se borró el mensaje, el chat o la cuenta
 * por cualquier camino): se borra el archivo y después la fila (si el archivo
 * no se pudo borrar, la fila queda para la próxima). Corre desde el cron
 * horario; borrar dos veces el mismo archivo no hace daño.
 */
export async function sweepOrphanMedia(limit = 200): Promise<number> {
  const db = getDb();
  const orphan = 'NOT EXISTS (SELECT 1 FROM inbox_messages m WHERE m.id = inbox_media_files.message_id)';
  const rows = (await db.prepare(`SELECT message_id, file_ref FROM inbox_media_files WHERE ${orphan} LIMIT ?`).all(limit)) as Array<{ message_id: string; file_ref: string }>;
  let n = 0;
  for (const r of rows) {
    if (!(await files.removeOne(r.file_ref).catch(() => false))) continue;
    const gone = await db.prepare(`DELETE FROM inbox_media_files WHERE message_id = ? AND file_ref = ? AND ${orphan}`).run(r.message_id, r.file_ref);
    if (gone.changes > 0) n++;
  }
  return n;
}
