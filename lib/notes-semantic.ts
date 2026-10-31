/**
 * Notes: búsqueda por significado. Reusa el índice de Agents (lib/agents-semantic.ts):
 * embeddings por workspace y hash del pasaje, fusionados con palabras clave.
 * Solo busca en las notas propias, sin papelera ni bloqueadas. Se indexa recién
 * cuando la persona lo usa por primera vez (gasta cuota de IA): de ahí en más
 * el cron va completando lo que falta. Server-only.
 */
import { getDb } from './db';
import { aiEnabled } from './ai';
import { embedPassages, hybridRank, passagesOf } from './agents-semantic';
import type { NoteOwner } from './notes';
import { ensureNotePrefsRow } from './notes-prefs';

const MAX_NOTES = 500;
const WARM_EVERY_MS = 10 * 60_000;

function fake(): boolean {
  return process.env.DOCS_AI_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

export function notesSemanticEnabled(): boolean {
  return aiEnabled() || fake();
}

async function noteDocs(owner: NoteOwner) {
  const rows = (await getDb()
    .prepare(
      `SELECT id, title, body_text FROM notes WHERE workspace_id = ? AND person_id = ? AND trashed_at IS NULL AND locked IS NULL
       ORDER BY updated_at DESC LIMIT ${MAX_NOTES}`,
    )
    .all(owner.workspaceId, owner.personId)) as Array<{ id: string; title: string; body_text: string }>;
  return rows.filter((r) => r.title.trim() || r.body_text.trim()).map((r) => ({ kind: 'note' as const, title: r.title, text: r.body_text || r.title, source: r.id }));
}

/** Ids de notas por relevancia (cada nota una vez). `degraded`: el modelo falló y son solo palabras clave. */
export async function semanticNoteIds(owner: NoteOwner, q: string, limit = 20): Promise<{ ids: string[]; degraded: boolean }> {
  await ensureNotePrefsRow(owner);
  await getDb()
    .prepare('UPDATE note_prefs SET semantic_at = COALESCE(semantic_at, ?) WHERE workspace_id = ? AND person_id = ?')
    .run(new Date().toISOString(), owner.workspaceId, owner.personId);
  const docs = await noteDocs(owner);
  let degraded = false;
  const ranked = await hybridRank(owner.workspaceId, docs, q, limit * 2, {
    fake: fake(),
    onFallback: () => {
      degraded = true;
    },
  });
  const ids: string[] = [];
  for (const r of ranked) {
    if (r.source && !ids.includes(r.source)) ids.push(r.source);
    if (ids.length >= limit) break;
  }
  return { ids, degraded };
}

/** Cron: completa el índice de quienes ya usaron la búsqueda (claim por persona). */
export async function warmNoteEmbeddings(opts: { people?: number; now?: Date } = {}): Promise<number> {
  if (!notesSemanticEnabled()) return 0;
  const db = getDb();
  const now = opts.now ?? new Date();
  const before = new Date(now.getTime() - WARM_EVERY_MS).toISOString();
  const people = (await db
    .prepare(
      `SELECT workspace_id, person_id, semantic_warmed_at FROM note_prefs
       WHERE semantic_at IS NOT NULL AND (semantic_warmed_at IS NULL OR semantic_warmed_at < ?) LIMIT ?`,
    )
    .all(before, opts.people ?? 3)) as Array<{ workspace_id: string; person_id: string; semantic_warmed_at: string | null }>;
  let done = 0;
  for (const p of people) {
    const claim = await db
      .prepare('UPDATE note_prefs SET semantic_warmed_at = ? WHERE workspace_id = ? AND person_id = ? AND semantic_warmed_at IS ?')
      .run(now.toISOString(), p.workspace_id, p.person_id, p.semantic_warmed_at);
    if (claim.changes === 0) continue;
    const owner = { workspaceId: p.workspace_id, personId: p.person_id };
    done += await embedPassages(owner.workspaceId, passagesOf(await noteDocs(owner)), { fake: fake(), max: 128 }).catch(() => 0);
  }
  return done;
}
