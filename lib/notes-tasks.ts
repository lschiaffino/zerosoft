/**
 * Notes: tareas. Cada bloque todo de una nota es una tarea; la fecha y el
 * responsable viven en note_tasks (por nota y bloque), fuera del contenido,
 * para que el autoguardado del editor no los pise. La vista de tareas junta
 * las de mis notas y las que me asignaron en notas de otras personas. Las
 * notas bloqueadas y las de la papelera no aparecen. Server-only.
 */
import { getDb, type NoteRow } from './db';
import type { DocsBlock } from './docs-types';
import { createNotification } from './notifications';
import { updateNote, type NoteOwner } from './notes';
import { listNoteShares, noteShareCandidates, resolveNoteAccess, setNoteShare } from './notes-shares';
import { blocksToText, noteHref } from './notes-types';
import type { NoteTask, NoteTaskMeta } from './notes-tasks-shared';

const MAX_NOTES = 1000;

/** Texto de un todo, sin el "[ ]" con el que entra al cuerpo de búsqueda. */
const plainTodo = (b: DocsBlock) => blocksToText([{ ...b, type: 'paragraph' }]);

function parseBlocks(raw: string | null | undefined): DocsBlock[] {
  try {
    return JSON.parse(raw || '[]') as DocsBlock[];
  } catch {
    return [];
  }
}

async function peopleNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return out;
  const rows = (await getDb()
    .prepare(`SELECT id, name, email FROM users WHERE id IN (${uniq.map(() => '?').join(',')})`)
    .all(...uniq)) as Array<{ id: string; name: string | null; email: string }>;
  for (const r of rows) out.set(r.id, r.name || r.email);
  return out;
}

export async function listTasks(viewer: NoteOwner): Promise<NoteTask[]> {
  const db = getDb();
  const own = (await db
    .prepare(
      `SELECT id, title, content, person_id FROM notes
       WHERE workspace_id = ? AND person_id = ? AND trashed_at IS NULL AND locked IS NULL
         AND EXISTS (SELECT 1 FROM json_each(content) WHERE json_extract(value, '$.type') = 'todo')
       ORDER BY updated_at DESC LIMIT ${MAX_NOTES}`,
    )
    .all(viewer.workspaceId, viewer.personId)) as Array<Pick<NoteRow, 'id' | 'title' | 'content' | 'person_id'>>;
  const assigned = (await db
    .prepare(
      `SELECT n.id, n.title, n.content, n.person_id FROM notes n
       WHERE n.workspace_id = ? AND n.person_id <> ? AND n.trashed_at IS NULL AND n.locked IS NULL
         AND n.id IN (SELECT note_id FROM note_tasks WHERE assignee_id = ?)
       LIMIT ${MAX_NOTES}`,
    )
    .all(viewer.workspaceId, viewer.personId, viewer.personId)) as typeof own;
  const notes = [...own, ...assigned];
  if (!notes.length) return [];
  const metaRows = (await db
    .prepare(`SELECT note_id, block_id, due_date, assignee_id FROM note_tasks WHERE note_id IN (${notes.map(() => '?').join(',')})`)
    .all(...notes.map((n) => n.id))) as Array<{ note_id: string; block_id: string; due_date: string | null; assignee_id: string | null }>;
  const meta = new Map(metaRows.map((m) => [`${m.note_id}:${m.block_id}`, m]));
  const names = await peopleNames(metaRows.map((m) => m.assignee_id).filter((x): x is string => Boolean(x)));
  const tasks: NoteTask[] = [];
  for (const n of notes) {
    const mine = n.person_id === viewer.personId;
    for (const b of parseBlocks(n.content)) {
      if (b.type !== 'todo') continue;
      const m = meta.get(`${n.id}:${b.id}`);
      if (!mine && m?.assignee_id !== viewer.personId) continue;
      const text = plainTodo(b).trim();
      if (!text) continue;
      tasks.push({
        note_id: n.id,
        note_title: n.title,
        block_id: b.id,
        text: text.slice(0, 300),
        checked: Boolean(b.checked),
        due: m?.due_date ?? null,
        assignee_id: m?.assignee_id ?? null,
        assignee_name: m?.assignee_id ? (names.get(m.assignee_id) ?? null) : null,
        mine,
      });
    }
  }
  return tasks;
}

/** Fecha y responsable de los todos de una nota, y a quién se le puede asignar. */
export async function noteTaskMeta(
  viewer: NoteOwner,
  noteId: string,
): Promise<{ meta: Record<string, NoteTaskMeta>; candidates: Array<{ id: string; name: string }>; canEdit: boolean } | null> {
  const access = await resolveNoteAccess(viewer, noteId);
  if (!access) return null;
  const rows = (await getDb().prepare('SELECT block_id, due_date, assignee_id FROM note_tasks WHERE note_id = ?').all(noteId)) as Array<{
    block_id: string;
    due_date: string | null;
    assignee_id: string | null;
  }>;
  const names = await peopleNames(rows.map((r) => r.assignee_id).filter((x): x is string => Boolean(x)));
  const meta: Record<string, NoteTaskMeta> = {};
  for (const r of rows) meta[r.block_id] = { due: r.due_date, assignee_id: r.assignee_id, assignee_name: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null };
  const ownerName = await peopleNames([access.owner.personId]);
  const self = { id: access.owner.personId, name: ownerName.get(access.owner.personId) ?? '' };
  // El dueño asigna a cualquiera del workspace (se le comparte); quien edita una
  // nota ajena, solo a quien ya la puede editar.
  const others =
    access.access === 'owner'
      ? (await noteShareCandidates(access.owner)).map((p) => ({ id: p.id, name: p.name || p.email }))
      : ((await listNoteShares(access.owner, { kind: 'note', id: noteId })) ?? []).filter((s) => s.role === 'edit').map((s) => ({ id: s.person_id, name: s.name || s.email }));
  return { meta, candidates: [self, ...others.filter((p) => p.id !== self.id)], canEdit: access.access !== 'view' };
}

export type TaskError = 'not_found' | 'forbidden' | 'not_member' | 'locked';

/** Cambia fecha o responsable. Asignar comparte la nota con esa persona (si lo hace el dueño). */
export async function setTaskMeta(
  viewer: NoteOwner,
  noteId: string,
  blockId: string,
  patch: { due?: string | null; assignee_id?: string | null },
): Promise<NoteTaskMeta | TaskError> {
  const access = await resolveNoteAccess(viewer, noteId);
  if (!access || access.row.trashed_at) return 'not_found';
  if (access.access === 'view') return 'forbidden';
  if (access.row.locked != null) return 'locked';
  const blocks = parseBlocks(access.row.content);
  const block = blocks.find((b) => b.id === blockId && b.type === 'todo');
  if (!block) return 'not_found';
  const db = getDb();
  const cur = (await db.prepare('SELECT due_date, assignee_id FROM note_tasks WHERE note_id = ? AND block_id = ?').get(noteId, blockId)) as
    | { due_date: string | null; assignee_id: string | null }
    | undefined;
  const due = patch.due !== undefined ? patch.due : (cur?.due_date ?? null);
  const assignee = patch.assignee_id !== undefined ? patch.assignee_id : (cur?.assignee_id ?? null);
  if (patch.assignee_id && patch.assignee_id !== access.owner.personId && patch.assignee_id !== cur?.assignee_id) {
    const allowed = await noteTaskMeta(viewer, noteId);
    if (!allowed?.candidates.some((c) => c.id === patch.assignee_id)) return 'not_member';
    if (access.access === 'owner') {
      const shares = (await listNoteShares(access.owner, { kind: 'note', id: noteId })) ?? [];
      if (!shares.some((s) => s.person_id === patch.assignee_id && s.role === 'edit')) {
        const res = await setNoteShare(access.owner, { kind: 'note', id: noteId }, patch.assignee_id, 'edit');
        if (res === 'not_member' || res === 'not_found') return 'not_member';
      }
    }
  }
  await db
    .prepare(
      `INSERT INTO note_tasks (note_id, block_id, due_date, assignee_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (note_id, block_id) DO UPDATE SET due_date = excluded.due_date, assignee_id = excluded.assignee_id,
         notified_at = CASE WHEN excluded.due_date IS note_tasks.due_date AND excluded.assignee_id IS note_tasks.assignee_id THEN note_tasks.notified_at ELSE NULL END`,
    )
    .run(noteId, blockId, due, assignee);
  if (assignee && assignee !== cur?.assignee_id && assignee !== viewer.personId) {
    await createNotification({
      userId: assignee,
      type: 'note_task',
      title: plainTodo(block).trim().slice(0, 140) || access.row.title,
      body: access.row.title || undefined,
      href: noteHref(noteId),
      sourceType: 'note',
      sourceId: noteId,
    }).catch(() => undefined);
  }
  const names = await peopleNames(assignee ? [assignee] : []);
  return { due, assignee_id: assignee, assignee_name: assignee ? (names.get(assignee) ?? null) : null };
}

/** Marca o desmarca un todo desde la vista de tareas (reescribe el bloque en la nota). */
export async function setTaskChecked(viewer: NoteOwner, noteId: string, blockId: string, checked: boolean): Promise<{ updated_at: string } | TaskError> {
  const access = await resolveNoteAccess(viewer, noteId);
  if (!access) return 'not_found';
  if (access.access === 'view') return 'forbidden';
  if (access.row.locked != null) return 'locked';
  const blocks = parseBlocks(access.row.content);
  if (!blocks.some((b) => b.id === blockId && b.type === 'todo')) return 'not_found';
  const note = await updateNote(access.owner, noteId, { content: blocks.map((b) => (b.id === blockId ? { ...b, checked } : b)) });
  return note ? { updated_at: note.updated_at } : 'not_found';
}

/** Avisa las tareas vencidas o de hoy. Cada fila se reclama con compare-and-set de notified_at. */
export async function fireNoteTasksDue(opts: { limit?: number; now?: Date } = {}): Promise<number> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const rows = (await db
    .prepare(
      `SELECT t.note_id, t.block_id, t.assignee_id, n.person_id, n.title, n.content FROM note_tasks t
       JOIN notes n ON n.id = t.note_id
       WHERE t.due_date IS NOT NULL AND t.due_date <= ? AND t.notified_at IS NULL AND n.trashed_at IS NULL AND n.locked IS NULL
       LIMIT ?`,
    )
    .all(now.toISOString().slice(0, 10), Math.min(opts.limit ?? 200, 500))) as Array<{
    note_id: string;
    block_id: string;
    assignee_id: string | null;
    person_id: string;
    title: string;
    content: string;
  }>;
  let sent = 0;
  for (const r of rows) {
    const claim = await db.prepare('UPDATE note_tasks SET notified_at = ? WHERE note_id = ? AND block_id = ? AND notified_at IS NULL').run(now.toISOString(), r.note_id, r.block_id);
    if (claim.changes === 0) continue;
    const block = parseBlocks(r.content).find((b) => b.id === r.block_id);
    if (!block || block.type !== 'todo' || block.checked) continue;
    await createNotification({
      userId: r.assignee_id ?? r.person_id,
      type: 'note_task',
      title: plainTodo(block).trim().slice(0, 140) || r.title,
      body: r.title || undefined,
      href: noteHref(r.note_id),
      sourceType: 'note',
      sourceId: r.note_id,
    }).catch(() => undefined);
    sent++;
  }
  return sent;
}
