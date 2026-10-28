/**
 * Notes — plantillas propias y búsquedas guardadas de cada persona.
 *
 * Las dos son de la persona dentro del workspace activo (como las notas):
 * nadie ve las de otro miembro. Las plantillas de fábrica no viven acá sino
 * en código (lib/notes-templates-builtin.ts, sobre las de Docs).
 */
import { getDb } from './db';
import type { DocsBlock } from './docs-types';
import { sanitizeBlocks } from './docs-sanitize';
import { isFileBlockType } from './docs-files';
import type { NoteOwner } from './notes';
import type { NoteTemplateInfo, SavedSearchInfo } from './notes-types';

const OWNER_WHERE = 'workspace_id = ? AND person_id = ?';
const ownerArgs = (o: NoteOwner) => [o.workspaceId, o.personId];
const nowIso = () => new Date().toISOString();

/** Tope de plantillas y búsquedas guardadas por persona. */
export const NOTE_TEMPLATES_MAX = 100;
export const SAVED_SEARCHES_MAX = 50;

interface TemplateRow {
  id: string;
  name: string;
  title: string;
  content: string;
  updated_at: string;
}

function toTemplate(r: TemplateRow): NoteTemplateInfo {
  let content: DocsBlock[] = [];
  try {
    content = JSON.parse(r.content) as DocsBlock[];
  } catch {
    content = [];
  }
  return { id: r.id, name: r.name, title: r.title, content, updated_at: r.updated_at };
}

export class NoteLibraryError extends Error {
  constructor(public code: 'limit_reached') {
    super(code);
  }
}

export async function listNoteTemplates(owner: NoteOwner): Promise<NoteTemplateInfo[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, name, title, content, updated_at FROM note_templates WHERE ${OWNER_WHERE} ORDER BY name COLLATE NOCASE LIMIT ${NOTE_TEMPLATES_MAX}`,
    )
    .all(...ownerArgs(owner))) as unknown as TemplateRow[];
  return rows.map(toTemplate);
}

/**
 * Guarda una plantilla a partir de una nota. Los adjuntos no se copian: un
 * archivo es de su nota (se borra con ella), así que quedan afuera.
 */
export async function createNoteTemplate(
  owner: NoteOwner,
  input: { name: string; title?: string; content: DocsBlock[] },
): Promise<NoteTemplateInfo> {
  const db = getDb();
  const count = (await db
    .prepare(`SELECT COUNT(*) AS n FROM note_templates WHERE ${OWNER_WHERE}`)
    .get(...ownerArgs(owner))) as { n: number };
  if (Number(count.n) >= NOTE_TEMPLATES_MAX) throw new NoteLibraryError('limit_reached');
  const id = crypto.randomUUID();
  const now = nowIso();
  const content = sanitizeBlocks(input.content.filter((b) => !isFileBlockType(b.type)));
  const name = input.name.trim();
  const title = (input.title ?? '').trim();
  await db
    .prepare(
      'INSERT INTO note_templates (id, workspace_id, person_id, name, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, owner.workspaceId, owner.personId, name, title, JSON.stringify(content), now, now);
  return { id, name, title, content, updated_at: now };
}

export async function renameNoteTemplate(owner: NoteOwner, id: string, name: string): Promise<boolean> {
  const res = await getDb()
    .prepare(`UPDATE note_templates SET name = ?, updated_at = ? WHERE id = ? AND ${OWNER_WHERE}`)
    .run(name.trim(), nowIso(), id, ...ownerArgs(owner));
  return res.changes > 0;
}

export async function deleteNoteTemplate(owner: NoteOwner, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare(`DELETE FROM note_templates WHERE id = ? AND ${OWNER_WHERE}`)
    .run(id, ...ownerArgs(owner));
  return res.changes > 0;
}

/** Plantillas propias que coinciden por nombre (⌘K). */
export async function searchNoteTemplates(owner: NoteOwner, q: string, limit = 3): Promise<Array<{ id: string; name: string }>> {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  return (await listNoteTemplates(owner))
    .filter((t) => t.name.toLowerCase().includes(term))
    .slice(0, limit)
    .map((t) => ({ id: t.id, name: t.name }));
}

// ---------- Búsquedas guardadas ----------

export async function listSavedSearches(owner: NoteOwner): Promise<SavedSearchInfo[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, name, query FROM note_saved_searches WHERE ${OWNER_WHERE} ORDER BY name COLLATE NOCASE LIMIT ${SAVED_SEARCHES_MAX}`,
    )
    .all(...ownerArgs(owner))) as unknown as SavedSearchInfo[];
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), query: String(r.query) }));
}

export async function createSavedSearch(owner: NoteOwner, input: { name: string; query: string }): Promise<SavedSearchInfo> {
  const db = getDb();
  const count = (await db
    .prepare(`SELECT COUNT(*) AS n FROM note_saved_searches WHERE ${OWNER_WHERE}`)
    .get(...ownerArgs(owner))) as { n: number };
  if (Number(count.n) >= SAVED_SEARCHES_MAX) throw new NoteLibraryError('limit_reached');
  const id = crypto.randomUUID();
  const name = input.name.trim();
  const query = input.query.trim();
  await db
    .prepare('INSERT INTO note_saved_searches (id, workspace_id, person_id, name, query, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, owner.workspaceId, owner.personId, name, query, nowIso());
  return { id, name, query };
}

export async function updateSavedSearch(
  owner: NoteOwner,
  id: string,
  patch: { name?: string; query?: string },
): Promise<SavedSearchInfo | null> {
  const sets: string[] = [];
  const args: string[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name.trim());
  }
  if (patch.query !== undefined) {
    sets.push('query = ?');
    args.push(patch.query.trim());
  }
  if (!sets.length) return null;
  const db = getDb();
  const res = await db
    .prepare(`UPDATE note_saved_searches SET ${sets.join(', ')} WHERE id = ? AND ${OWNER_WHERE}`)
    .run(...args, id, ...ownerArgs(owner));
  if (!res.changes) return null;
  const row = (await db
    .prepare(`SELECT id, name, query FROM note_saved_searches WHERE id = ? AND ${OWNER_WHERE}`)
    .get(id, ...ownerArgs(owner))) as unknown as SavedSearchInfo | undefined;
  return row ? { id: String(row.id), name: String(row.name), query: String(row.query) } : null;
}

export async function deleteSavedSearch(owner: NoteOwner, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare(`DELETE FROM note_saved_searches WHERE id = ? AND ${OWNER_WHERE}`)
    .run(id, ...ownerArgs(owner));
  return res.changes > 0;
}

/** Búsquedas guardadas que coinciden por nombre (⌘K). */
export async function searchSavedSearches(owner: NoteOwner, q: string, limit = 3): Promise<SavedSearchInfo[]> {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  return (await listSavedSearches(owner)).filter((s) => s.name.toLowerCase().includes(term)).slice(0, limit);
}
