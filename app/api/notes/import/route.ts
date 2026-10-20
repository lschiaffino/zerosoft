import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { NotesError, createNote, listNotebooks, noteOwner } from '@/lib/notes';
import {
  NOTES_IMPORT_MAX_BYTES,
  NOTES_IMPORT_MAX_FILES,
  NotesImportError,
  enexToNotes,
  importKind,
  markdownToNote,
  type ImportedNote,
} from '@/lib/notes-import';
import { saveUpload } from '@/lib/uploads';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface ImportFileError {
  file: string;
  code: string;
}

/**
 * Importa notas desde archivos: .enex (export de Evernote, con sus adjuntos,
 * tags, fechas y link de origen) y .md / .markdown / .txt (una nota por
 * archivo). Multipart con uno o más `file` y `notebook_id` opcional. Tope de
 * NOTES_IMPORT_MAX_BYTES por archivo y NOTES_IMPORT_MAX_FILES por request.
 * Un archivo que falla no frena al resto: vuelve en `errors`.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:import', owner.personId, 20);
  if (limited) return limited;

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, 'invalid_input');
  const files = form.getAll('file').filter((f): f is File => f instanceof Blob);
  if (files.length === 0) return jsonError(400, 'invalid_input');
  if (files.length > NOTES_IMPORT_MAX_FILES) return jsonError(413, 'too_many_files');
  const notebookRaw = form.get('notebook_id');
  const notebookId = typeof notebookRaw === 'string' && notebookRaw ? notebookRaw.slice(0, 64) : null;
  // La libreta se valida antes de subir adjuntos (no quedan archivos huérfanos).
  if (notebookId && !(await listNotebooks(owner)).some((nb) => nb.id === notebookId)) {
    return jsonError(400, 'notebook_not_found');
  }

  const created: Array<{ id: string; title: string }> = [];
  const errors: ImportFileError[] = [];
  for (const file of files) {
    const name = (file.name || 'note').slice(0, 255);
    const kind = importKind(name);
    if (!kind) {
      errors.push({ file: name, code: 'unsupported_type' });
      continue;
    }
    if (file.size > NOTES_IMPORT_MAX_BYTES) {
      errors.push({ file: name, code: 'file_too_large' });
      continue;
    }
    const text = await file.text();
    let notes: ImportedNote[];
    try {
      notes =
        kind === 'enex'
          ? await enexToNotes(text, async (res) => {
              try {
                const url = await saveUpload('docs', res.name, res.mime, res.data);
                return { url, name: res.name, size: res.data.length, mime: res.mime };
              } catch {
                // Tipo bloqueado (SVG, HTML…) o storage caído: el adjunto se omite.
                return null;
              }
            })
          : [markdownToNote(text, name)];
    } catch (err) {
      errors.push({ file: name, code: err instanceof NotesImportError ? err.code : 'invalid_file' });
      continue;
    }
    for (const n of notes) {
      try {
        const note = await createNote(owner, {
          title: n.title,
          content: n.blocks,
          tags: n.tags,
          notebook_id: notebookId,
          source_url: n.sourceUrl,
          created_at: n.createdAt,
          updated_at: n.updatedAt,
        });
        created.push({ id: note.id, title: note.title });
      } catch (err) {
        if (err instanceof NotesError) return jsonError(400, err.code);
        throw err;
      }
    }
  }
  return NextResponse.json({ imported: created.length, notes: created, errors }, { status: created.length ? 201 : 200 });
}
