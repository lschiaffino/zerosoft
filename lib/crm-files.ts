/**
 * CRM — archivos adjuntos. Server-only.
 *
 * Dos lugares, mismo almacenamiento (lib/uploads.ts, carpeta "tasks"):
 * - Actividades (tareas, notas, llamadas, reuniones): crm_task_files, por
 *   activity_id. Es la tabla que ya usaban las tareas.
 * - Registros (contactos, empresas, deals): crm_record_files, con una FK por
 *   entidad en cascada.
 *
 * Las dos tablas cuelgan por FK ON DELETE CASCADE de su registro o actividad:
 * la papelera (lib/crm-trash.ts) las guarda en el snapshot al borrar y las
 * re-inserta al restaurar, así que el archivo no se borra del almacenamiento
 * mientras esté en la papelera. Borrar un adjunto a mano sí lo borra.
 */
import { getDb, type CrmRecordFileRow, type CrmTaskFileRow } from './db';
import { deleteUploads, MAX_UPLOAD_SIZE, saveUpload, UploadError } from './uploads';

export type FileEntity = 'contact' | 'company' | 'deal';

const ENTITY_COL: Record<FileEntity, 'contact_id' | 'company_id' | 'deal_id'> = {
  contact: 'contact_id',
  company: 'company_id',
  deal: 'deal_id',
};

/** Vista liviana de un adjunto para la UI (actividad o registro). */
export interface FileView {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
  created_at: string;
}

export async function listRecordFiles(userId: string, entity: FileEntity, recordId: string): Promise<CrmRecordFileRow[]> {
  return (await getDb()
    .prepare(`SELECT * FROM crm_record_files WHERE user_id = ? AND ${ENTITY_COL[entity]} = ? ORDER BY created_at DESC, id`)
    .all(userId, recordId)) as CrmRecordFileRow[];
}

export async function createRecordFile(
  userId: string,
  entity: FileEntity,
  recordId: string,
  data: { filename: string; contentType: string; size: number; url: string; uploadedBy?: string },
): Promise<CrmRecordFileRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const col = ENTITY_COL[entity];
  await db
    .prepare(
      `INSERT INTO crm_record_files (id, user_id, ${col}, filename, content_type, size, url, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, recordId, data.filename.slice(0, 255), data.contentType, data.size, data.url, data.uploadedBy ?? '');
  return (await db.prepare('SELECT * FROM crm_record_files WHERE id = ?').get(id)) as CrmRecordFileRow;
}

/** Borra el adjunto y su archivo. false si no es de ese registro. */
export async function deleteRecordFile(userId: string, entity: FileEntity, recordId: string, fileId: string): Promise<boolean> {
  const db = getDb();
  const row = (await db
    .prepare(`SELECT url FROM crm_record_files WHERE id = ? AND user_id = ? AND ${ENTITY_COL[entity]} = ?`)
    .get(fileId, userId, recordId)) as { url: string } | undefined;
  if (!row) return false;
  await db.prepare('DELETE FROM crm_record_files WHERE id = ?').run(fileId);
  await deleteUploads([row.url]);
  return true;
}

/** Adjuntos de varias actividades de una vez: activity_id → archivos (más nuevo primero). */
export async function listActivityFiles(activityIds: string[]): Promise<Map<string, CrmTaskFileRow[]>> {
  const out = new Map<string, CrmTaskFileRow[]>();
  const ids = [...new Set(activityIds)];
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    const rows = (await getDb()
      .prepare(
        `SELECT * FROM crm_task_files WHERE activity_id IN (${part.map(() => '?').join(',')}) ORDER BY created_at DESC, id`,
      )
      .all(...part)) as CrmTaskFileRow[];
    for (const r of rows) out.set(r.activity_id, [...(out.get(r.activity_id) ?? []), r]);
  }
  return out;
}

/** Suma a cada item del timeline sus adjuntos (los threads de email no tienen). */
export async function withActivityFiles<T extends { id: string; external?: boolean }>(
  items: T[],
): Promise<Array<T & { files?: FileView[] }>> {
  const own = items.filter((i) => !i.external).map((i) => i.id);
  const files = own.length ? await listActivityFiles(own) : new Map<string, CrmTaskFileRow[]>();
  return items.map((i) => {
    const list = files.get(i.id);
    return list?.length ? { ...i, files: list.map(toView) } : i;
  });
}

export function toView(f: CrmTaskFileRow | CrmRecordFileRow): FileView {
  return { id: f.id, filename: f.filename, content_type: f.content_type, size: f.size, url: f.url, created_at: f.created_at };
}

export class FileUploadError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

/**
 * Lee el archivo de un FormData (`file`) y lo guarda. Errores como
 * FileUploadError (código + status para la respuesta).
 */
export async function storeUploadedFile(
  form: FormData | null,
): Promise<{ filename: string; contentType: string; size: number; url: string }> {
  const file = form?.get('file');
  if (!(file instanceof Blob) || file.size === 0) throw new FileUploadError('invalid_input', 400);
  if (file.size > MAX_UPLOAD_SIZE) throw new FileUploadError('file_too_large', 413);
  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = (file as File).name || 'upload';
  const contentType = file.type || 'application/octet-stream';
  try {
    const url = await saveUpload('tasks', filename, contentType, buffer);
    return { filename, contentType, size: file.size, url };
  } catch (err) {
    if (err instanceof UploadError) throw new FileUploadError(err.code, err.status);
    throw err;
  }
}
