/** Notes: preferencias por persona (inicio con widgets, bloc rápido). Server-only. */
import { getDb } from './db';
import type { NoteOwner } from './notes';
import { cleanHomeWidgets, DEFAULT_HOME_WIDGETS, type HomeWidget } from './notes-home';

export interface NotePrefs {
  home: HomeWidget[];
  scratch: string;
}

export async function getNotePrefs(owner: NoteOwner): Promise<NotePrefs> {
  const row = (await getDb().prepare('SELECT home, scratch FROM note_prefs WHERE workspace_id = ? AND person_id = ?').get(owner.workspaceId, owner.personId)) as
    | { home: string | null; scratch: string }
    | undefined;
  let home: HomeWidget[] = [...DEFAULT_HOME_WIDGETS];
  if (row?.home) {
    try {
      home = cleanHomeWidgets(JSON.parse(row.home));
    } catch {
      // Valor roto: el inicio de fábrica.
    }
  }
  return { home, scratch: row?.scratch ?? '' };
}

export async function ensureNotePrefsRow(owner: NoteOwner): Promise<void> {
  await getDb().prepare('INSERT OR IGNORE INTO note_prefs (workspace_id, person_id) VALUES (?, ?)').run(owner.workspaceId, owner.personId);
}

export async function saveNotePrefs(owner: NoteOwner, patch: { home?: string[]; scratch?: string }): Promise<NotePrefs> {
  await ensureNotePrefsRow(owner);
  const db = getDb();
  if (patch.home !== undefined) {
    await db.prepare('UPDATE note_prefs SET home = ? WHERE workspace_id = ? AND person_id = ?').run(JSON.stringify(cleanHomeWidgets(patch.home)), owner.workspaceId, owner.personId);
  }
  if (patch.scratch !== undefined) {
    await db.prepare('UPDATE note_prefs SET scratch = ? WHERE workspace_id = ? AND person_id = ?').run(patch.scratch, owner.workspaceId, owner.personId);
  }
  return getNotePrefs(owner);
}
