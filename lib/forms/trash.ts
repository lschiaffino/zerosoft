/**
 * Forms: papelera de la retención. Server-only.
 *
 * La limpieza horaria (purgeFormsRetention) manda a la papelera las respuestas que pasan la retención del form y
 * las parciales abandonadas; acá se listan (solo fecha y plazo, nunca el contenido) y se restauran. Quien tiene
 * acceso al form ve y restaura las de ese form. Una respuesta restaurada vuelve a contar su retención desde ese
 * momento (retained_at) y vuelve a ocupar su lugar en el contador del form.
 */
import { getDb } from '../db';
import { listSoftDeleted, purgeSoftDeleted, restoreSoftDeleted, type SoftDeleteEntry } from '../soft-delete';
import { accessibleRow } from './core';
import { FormsError, type FormsActor } from './types';

export interface FormsTrashItem {
  id: string;
  kind: 'response' | 'partial';
  /** Fecha del envío (o de la última edición de una parcial). */
  date: string;
  deletedAt: string;
  purgeAt: string;
}

function itemOf(e: SoftDeleteEntry): FormsTrashItem {
  return { id: e.id, kind: e.kind === 'partial' ? 'partial' : 'response', date: e.label, deletedAt: e.deletedAt, purgeAt: e.purgeAt };
}

export async function listFormTrash(actor: FormsActor, formId: string): Promise<FormsTrashItem[]> {
  if (!(await accessibleRow(actor, formId))) throw new FormsError('not_found', 404);
  return (await listSoftDeleted(actor.ws, 'forms', { scopeIds: [formId], limit: 500 })).map(itemOf);
}

/** Restaura una respuesta de la papelera del form. conflict si su lugar se ocupó mientras tanto. */
export async function restoreFormTrash(actor: FormsActor, formId: string, entryId: string, at = new Date()): Promise<FormsTrashItem> {
  if (!(await accessibleRow(actor, formId))) throw new FormsError('not_found', 404);
  const items = await listSoftDeleted(actor.ws, 'forms', { scopeIds: [formId], limit: 500 });
  const entry = items.find((e) => e.id === entryId);
  if (!entry) throw new FormsError('not_found', 404);
  const res = await restoreSoftDeleted(actor.ws, 'forms', entryId);
  if (!res.ok) throw new FormsError(res.reason, res.reason === 'conflict' ? 409 : 404);
  const db = getDb();
  await db.prepare('UPDATE forms_responses SET retained_at = ?, purge_claimed_at = NULL WHERE id = ? AND form_id = ?').run(at.toISOString(), entry.recordId, formId);
  if (entry.kind === 'response') await db.prepare('UPDATE forms_forms SET response_count = response_count + 1 WHERE id = ?').run(formId);
  return itemOf(entry);
}

/** Al borrar un form, lo que tenía en la papelera se purga ya (con sus archivos). */
export async function purgeFormTrash(ws: string, formId: string): Promise<void> {
  for (;;) {
    const batch = await listSoftDeleted(ws, 'forms', { scopeIds: [formId], limit: 500 });
    if (!batch.length) return;
    for (const e of batch) await purgeSoftDeleted(ws, 'forms', e.id);
  }
}
