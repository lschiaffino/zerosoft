/**
 * Notes — historial de versiones.
 * - Al guardar título o contenido se guarda un snapshot del estado nuevo.
 *   Cada versión automática cubre una ventana de NOTE_VERSION_INTERVAL_MS: los
 *   guardados dentro de la ventana actualizan esa misma versión (así refleja
 *   lo último escrito) y el primero después de la ventana abre otra. La
 *   primera vez se guarda también el estado de antes, así la primera edición
 *   no lo pierde.
 * - Nunca se guarda una nota vacía (sin título ni texto) ni una versión
 *   igual a la anterior.
 * - "Guardar versión" fuerza un snapshot manual.
 * - Restaurar guarda primero el estado actual (kind 'restore') y después
 *   pisa título y contenido: nunca se pierde nada.
 * - Se conservan las últimas NOTE_MAX_VERSIONS por nota.
 * Todo filtra por dueño (workspace + persona): nadie ve versiones ajenas.
 */
import { getDb, type NoteRow } from './db';
import type { DocsBlock, DocsVersionSummary } from './docs-types';
import { htmlLiteToText } from './notes-types';

export const NOTE_VERSION_INTERVAL_MS = 5 * 60 * 1000;
export const NOTE_MAX_VERSIONS = 50;

export type NoteVersionKind = 'auto' | 'manual' | 'restore';

interface Owner {
  workspaceId: string;
  personId: string;
}

export interface NoteVersion extends DocsVersionSummary {
  content: DocsBlock[];
}

type Snapshot = Pick<NoteRow, 'id' | 'workspace_id' | 'person_id' | 'title' | 'content'>;

function parseBlocks(raw: string): DocsBlock[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as DocsBlock[]) : [];
  } catch {
    return [];
  }
}

/** Bloques que cuentan aunque no tengan texto (un divisor, una imagen, una tabla). */
const NON_TEXT_BLOCKS = new Set(['divider', 'table', 'database', 'image', 'file', 'board']);

/** Nota sin título ni contenido: no vale la pena como versión. */
export function isEmptyNoteSnapshot(title: string, content: string): boolean {
  if (title.trim()) return false;
  return parseBlocks(content).every((b) => !NON_TEXT_BLOCKS.has(b.type) && !htmlLiteToText(b.content ?? '').trim());
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined && x !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

/**
 * Clave para comparar dos estados: título + bloques sin ids y con las claves
 * ordenadas (el mismo contenido serializado distinto no cuenta como cambio).
 */
export function noteSnapshotKey(title: string, content: string): string {
  const blocks = parseBlocks(content).map((b) => {
    const { id: _id, ...rest } = b;
    void _id;
    return sortKeys(rest);
  });
  return JSON.stringify([title.trim(), blocks]);
}

async function noteRow(owner: Owner, noteId: string): Promise<NoteRow | null> {
  return ((await getDb()
    .prepare('SELECT * FROM notes WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .get(noteId, owner.workspaceId, owner.personId)) as NoteRow | undefined) ?? null;
}

async function insertSnapshot(note: Snapshot, kind: NoteVersionKind, at = new Date()): Promise<string> {
  const id = crypto.randomUUID();
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO note_versions (id, note_id, workspace_id, person_id, title, content, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, note.id, note.workspace_id, note.person_id, note.title, note.content, kind, at.toISOString());
  await db
    .prepare(
      `DELETE FROM note_versions WHERE note_id = ? AND id NOT IN (
         SELECT id FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
       )`,
    )
    .run(note.id, note.id, NOTE_MAX_VERSIONS);
  return id;
}

/**
 * Snapshot automático después de un guardado. `previous` es la fila antes
 * del cambio (si la nota nunca tuvo versiones, se guarda también ese estado).
 * Devuelve true si insertó o actualizó una versión.
 */
export async function maybeAutoSnapshotNote(
  owner: Owner,
  noteId: string,
  previous?: Pick<NoteRow, 'id' | 'workspace_id' | 'person_id' | 'title' | 'content' | 'updated_at'> | null,
  now = new Date(),
): Promise<boolean> {
  const note = await noteRow(owner, noteId);
  if (!note) return false;
  if (isEmptyNoteSnapshot(note.title, note.content)) return false;
  const db = getDb();
  const last = (await db
    .prepare(
      'SELECT id, title, content, kind, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    )
    .get(noteId)) as { id: string; title: string; content: string; kind: NoteVersionKind; created_at: string } | undefined;
  const key = noteSnapshotKey(note.title, note.content);
  if (last && noteSnapshotKey(last.title, last.content) === key) return false;

  // Dentro de la ventana de la última versión automática: se actualiza esa.
  if (last && last.kind === 'auto' && now.getTime() - Date.parse(last.created_at) < NOTE_VERSION_INTERVAL_MS) {
    await db
      .prepare('UPDATE note_versions SET title = ?, content = ? WHERE id = ?')
      .run(note.title, note.content, last.id);
    return true;
  }

  if (
    !last &&
    previous &&
    !isEmptyNoteSnapshot(previous.title, previous.content) &&
    noteSnapshotKey(previous.title, previous.content) !== key
  ) {
    const prevAt = Date.parse(previous.updated_at);
    const at = Number.isFinite(prevAt) && prevAt < now.getTime() ? new Date(prevAt) : new Date(now.getTime() - 1000);
    await insertSnapshot(previous, 'auto', at);
    // El estado de antes abre su propia ventana: lo nuevo va en otra versión.
    await insertSnapshot(note, 'auto', now);
    return true;
  }
  await insertSnapshot(note, 'auto', now);
  return true;
}

/** "Guardar versión": snapshot manual. null = la nota no existe. */
export async function saveNoteVersion(owner: Owner, noteId: string): Promise<string | null> {
  const note = await noteRow(owner, noteId);
  if (!note) return null;
  return insertSnapshot(note, 'manual');
}

export async function listNoteVersions(owner: Owner, noteId: string): Promise<DocsVersionSummary[]> {
  return (await getDb()
    .prepare(
      `SELECT v.id, v.note_id AS page_id, v.title, v.kind, v.person_id AS author_id, v.created_at,
              u.name AS author_name, u.email AS author_email
       FROM note_versions v
       LEFT JOIN users u ON u.id = v.person_id
       WHERE v.note_id = ? AND v.workspace_id = ? AND v.person_id = ?
       ORDER BY v.created_at DESC, v.rowid DESC`,
    )
    .all(noteId, owner.workspaceId, owner.personId)) as DocsVersionSummary[];
}

export async function getNoteVersion(owner: Owner, noteId: string, versionId: string): Promise<NoteVersion | null> {
  const row = (await getDb()
    .prepare(
      `SELECT v.id, v.note_id, v.title, v.content, v.kind, v.person_id, v.created_at,
              u.name AS author_name, u.email AS author_email
       FROM note_versions v
       LEFT JOIN users u ON u.id = v.person_id
       WHERE v.id = ? AND v.note_id = ? AND v.workspace_id = ? AND v.person_id = ?`,
    )
    .get(versionId, noteId, owner.workspaceId, owner.personId)) as
    | {
        id: string;
        note_id: string;
        title: string;
        content: string;
        kind: NoteVersionKind;
        person_id: string;
        created_at: string;
        author_name: string | null;
        author_email: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    page_id: row.note_id,
    title: row.title,
    kind: row.kind,
    author_id: row.person_id,
    author_name: row.author_name,
    author_email: row.author_email,
    created_at: row.created_at,
    content: parseBlocks(row.content),
  };
}

/** Guarda el estado actual antes de restaurar (lo usa lib/notes.ts). */
export async function snapshotBeforeRestore(note: Snapshot): Promise<void> {
  await insertSnapshot(note, 'restore');
}
