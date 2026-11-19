/**
 * People: notas sobre una persona (la pestaña Notas de la ficha, como en
 * BambooHR). Para lo administrativo: una charla, un acuerdo, un aviso. Las
 * leen y escriben HR y la cadena de managers; la persona no las ve. Cada nota
 * guarda quién la escribió y cuándo; la edita solo su autor y la borra su
 * autor o HR. Ver, escribir y borrar queda en el registro de accesos.
 * Server-only.
 */
import { getDb } from './db';
import { canChangeNote, canSeeNotes } from './people-access';
import { audit, getEmployeeRow, newId, nowIso, PeopleError, type PeopleCtx } from './people';

const db = () => getDb();

export const NOTE_MAX = 5000;

export interface EmployeeNote {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

interface NoteRow {
  id: string;
  employee_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author_name: string | null;
}

function cleanBody(raw: unknown): string {
  const body = String(raw ?? '').trim();
  if (!body) throw new PeopleError('note_required');
  if (body.length > NOTE_MAX) throw new PeopleError('note_too_long');
  return body;
}

function toNote(ctx: PeopleCtx, r: NoteRow): EmployeeNote {
  const note = { employeeId: r.employee_id, authorId: r.author_id };
  return {
    id: r.id,
    body: r.body,
    authorName: r.author_name || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    canEdit: canChangeNote(ctx.viewer, note, 'edit'),
    canDelete: canChangeNote(ctx.viewer, note, 'delete'),
  };
}

const SELECT = `SELECT n.*, COALESCE(NULLIF(e.name, ''), NULLIF(u.name, ''), u.email) AS author_name
  FROM people_notes n
  LEFT JOIN users u ON u.id = n.author_id
  LEFT JOIN people_employees e ON e.workspace_id = n.workspace_id AND e.user_id = n.author_id`;

async function visibleEmployee(ctx: PeopleCtx, employeeId: string) {
  const emp = await getEmployeeRow(ctx.ws, employeeId);
  // Quien no las puede ver recibe lo mismo que si la ficha no existiera.
  if (!emp || !canSeeNotes(ctx.viewer, employeeId)) throw new PeopleError('not_found', 404);
  return emp;
}

async function noteRow(ctx: PeopleCtx, id: string): Promise<NoteRow> {
  const r = (await db().prepare(`${SELECT} WHERE n.id = ? AND n.workspace_id = ?`).get(id, ctx.ws)) as NoteRow | undefined;
  if (!r || !canSeeNotes(ctx.viewer, r.employee_id)) throw new PeopleError('not_found', 404);
  return r;
}

/** Las notas de una ficha, la más nueva primero. */
export async function listNotes(ctx: PeopleCtx, employeeId: string): Promise<EmployeeNote[]> {
  await visibleEmployee(ctx, employeeId);
  const rows = (await db().prepare(`${SELECT} WHERE n.workspace_id = ? AND n.employee_id = ? ORDER BY n.created_at DESC, n.id DESC`).all(ctx.ws, employeeId)) as NoteRow[];
  if (rows.length) await audit(ctx, 'view', 'notes', employeeId);
  return rows.map((r) => toNote(ctx, r));
}

export async function addNote(ctx: PeopleCtx, employeeId: string, input: Record<string, unknown>): Promise<EmployeeNote> {
  await visibleEmployee(ctx, employeeId);
  const body = cleanBody(input.body);
  const id = newId('note');
  const now = nowIso();
  await db()
    .prepare('INSERT INTO people_notes (id, workspace_id, employee_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, ctx.ws, employeeId, ctx.personId, body, now, now);
  await audit(ctx, 'change', 'notes', employeeId);
  return toNote(ctx, await noteRow(ctx, id));
}

export async function updateNote(ctx: PeopleCtx, id: string, input: Record<string, unknown>): Promise<EmployeeNote> {
  const r = await noteRow(ctx, id);
  if (!canChangeNote(ctx.viewer, { employeeId: r.employee_id, authorId: r.author_id }, 'edit')) throw new PeopleError('forbidden', 403);
  const body = cleanBody(input.body);
  await db().prepare('UPDATE people_notes SET body = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(body, nowIso(), id, ctx.ws);
  await audit(ctx, 'change', 'notes', r.employee_id);
  return toNote(ctx, await noteRow(ctx, id));
}

export async function deleteNote(ctx: PeopleCtx, id: string): Promise<void> {
  const r = await noteRow(ctx, id);
  if (!canChangeNote(ctx.viewer, { employeeId: r.employee_id, authorId: r.author_id }, 'delete')) throw new PeopleError('forbidden', 403);
  await db().prepare('DELETE FROM people_notes WHERE id = ? AND workspace_id = ?').run(id, ctx.ws);
  await audit(ctx, 'change', 'notes', r.employee_id);
}
