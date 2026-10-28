/**
 * Voice: lo que organiza y reusa la persona (migración 126_voice_parity_2).
 * Server-only.
 *
 * - Carpetas de reuniones (como Granola): propias, con un nivel de
 *   subcarpetas. Borrar una carpeta deja sus reuniones sin carpeta.
 * - Prompts guardados: recipes (para una o varias reuniones, se corren con /
 *   en el chat) y transforms (reescrituras del dictado). Cada uno es de quien
 *   lo crea; con `shared` lo usa todo el workspace, pero solo su dueño lo
 *   edita o borra.
 * - Ajustes del workspace (los cambia un admin): tope de días para las
 *   transcripciones.
 * - Uso del equipo (panel de admin): dictados, palabras y reuniones por persona.
 */
import { getDb } from './db';
import { listBoardMembers } from './board-comments';
import { VoiceError, type VoiceOwner } from './voice';
import {
  DEFAULT_VOICE_WORKSPACE_SETTINGS,
  VOICE_FOLDERS_MAX,
  VOICE_PROMPTS_MAX,
  VOICE_RETENTION_DAYS,
  type VoiceFolder,
  type VoicePrompt,
  type VoicePromptKind,
  type VoiceWorkspaceSettings,
} from './voice-types';

const nowIso = () => new Date().toISOString();

// ---------- Carpetas ----------

export async function listFolders(owner: VoiceOwner): Promise<VoiceFolder[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT f.id, f.name, f.parent_id,
         (SELECT COUNT(*) FROM voice_sessions s WHERE s.folder_id = f.id AND s.workspace_id = f.workspace_id AND s.person_id = f.person_id AND s.kind = 'meeting') AS n
       FROM voice_folders f WHERE f.workspace_id = ? AND f.person_id = ? ORDER BY f.name COLLATE NOCASE`,
    )
    .all(owner.workspaceId, owner.personId)) as Array<{ id: string; name: string; parent_id: string | null; n: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, count: Number(r.n) || 0 }));
}

async function folderRow(owner: VoiceOwner, id: string): Promise<{ id: string; parent_id: string | null } | null> {
  const row = (await getDb()
    .prepare('SELECT id, parent_id FROM voice_folders WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .get(id, owner.workspaceId, owner.personId)) as { id: string; parent_id: string | null } | undefined;
  return row ?? null;
}

/** ¿La carpeta es de la persona? (para mover una reunión). */
export async function ownsFolder(owner: VoiceOwner, id: string): Promise<boolean> {
  return !!(await folderRow(owner, id));
}

/**
 * Carpeta nueva. Con `parentId`, una subcarpeta: solo un nivel (como Granola),
 * así que el padre tiene que ser de primer nivel.
 */
export async function createFolder(owner: VoiceOwner, input: { name: string; parentId?: string | null }): Promise<VoiceFolder> {
  const db = getDb();
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new VoiceError('invalid_state');
  if (input.parentId) {
    const parent = await folderRow(owner, input.parentId);
    if (!parent) throw new VoiceError('not_found');
    if (parent.parent_id) throw new VoiceError('invalid_state');
  }
  const count = (await db
    .prepare('SELECT COUNT(*) AS n FROM voice_folders WHERE workspace_id = ? AND person_id = ?')
    .get(owner.workspaceId, owner.personId)) as { n: number };
  if (Number(count.n) >= VOICE_FOLDERS_MAX) throw new VoiceError('limit_reached');
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare('INSERT INTO voice_folders (id, workspace_id, person_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner.workspaceId, owner.personId, input.parentId ?? null, name, now, now);
  return { id, name, parentId: input.parentId ?? null, count: 0 };
}

export async function renameFolder(owner: VoiceOwner, id: string, name: string): Promise<boolean> {
  const clean = name.trim().slice(0, 100);
  if (!clean) return false;
  const res = await getDb()
    .prepare('UPDATE voice_folders SET name = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .run(clean, nowIso(), id, owner.workspaceId, owner.personId);
  return res.changes > 0;
}

/** Borra la carpeta y sus subcarpetas; las reuniones quedan sin carpeta (no se borran). */
export async function deleteFolder(owner: VoiceOwner, id: string): Promise<boolean> {
  const db = getDb();
  if (!(await folderRow(owner, id))) return false;
  const ids = [
    id,
    ...((await db
      .prepare('SELECT id FROM voice_folders WHERE parent_id = ? AND workspace_id = ? AND person_id = ?')
      .all(id, owner.workspaceId, owner.personId)) as Array<{ id: string }>).map((r) => r.id),
  ];
  const marks = ids.map(() => '?').join(',');
  await db
    .prepare(`UPDATE voice_sessions SET folder_id = NULL WHERE workspace_id = ? AND person_id = ? AND folder_id IN (${marks})`)
    .run(owner.workspaceId, owner.personId, ...ids);
  await db.prepare(`DELETE FROM voice_folders WHERE workspace_id = ? AND person_id = ? AND id IN (${marks})`).run(owner.workspaceId, owner.personId, ...ids);
  return true;
}

// ---------- Recipes y transforms ----------

interface PromptRow {
  id: string;
  person_id: string;
  kind: VoicePromptKind;
  name: string;
  prompt: string;
  shared: number;
}

function toPrompt(r: PromptRow, personId: string): VoicePrompt {
  return { id: r.id, kind: r.kind, name: r.name, prompt: r.prompt, shared: !!Number(r.shared), mine: r.person_id === personId, builtin: false };
}

/** Los propios y los que el equipo compartió (de otra persona del workspace). */
export async function listPrompts(owner: VoiceOwner, kind: VoicePromptKind): Promise<VoicePrompt[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, person_id, kind, name, prompt, shared FROM voice_prompts
       WHERE workspace_id = ? AND kind = ? AND (person_id = ? OR shared = 1) ORDER BY name COLLATE NOCASE`,
    )
    .all(owner.workspaceId, kind, owner.personId)) as PromptRow[];
  return rows.map((r) => toPrompt(r, owner.personId));
}

/** Un prompt que la persona puede usar (propio o compartido con el equipo). */
export async function getUsablePrompt(owner: VoiceOwner, id: string): Promise<VoicePrompt | null> {
  const r = (await getDb()
    .prepare('SELECT id, person_id, kind, name, prompt, shared FROM voice_prompts WHERE id = ? AND workspace_id = ? AND (person_id = ? OR shared = 1)')
    .get(id, owner.workspaceId, owner.personId)) as PromptRow | undefined;
  return r ? toPrompt(r, owner.personId) : null;
}

export async function createPrompt(owner: VoiceOwner, input: { kind: VoicePromptKind; name: string; prompt: string; shared?: boolean }): Promise<VoicePrompt> {
  const db = getDb();
  const count = (await db
    .prepare('SELECT COUNT(*) AS n FROM voice_prompts WHERE workspace_id = ? AND person_id = ?')
    .get(owner.workspaceId, owner.personId)) as { n: number };
  if (Number(count.n) >= VOICE_PROMPTS_MAX) throw new VoiceError('limit_reached');
  const id = crypto.randomUUID();
  const now = nowIso();
  const name = input.name.trim().slice(0, 80);
  const prompt = input.prompt.trim().slice(0, 4000);
  await db
    .prepare('INSERT INTO voice_prompts (id, workspace_id, person_id, kind, name, prompt, shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner.workspaceId, owner.personId, input.kind, name, prompt, input.shared ? 1 : 0, now, now);
  return { id, kind: input.kind, name, prompt, shared: !!input.shared, mine: true, builtin: false };
}

/** Solo su dueño lo edita (aunque esté compartido). */
export async function updatePrompt(
  owner: VoiceOwner,
  id: string,
  input: { name?: string; prompt?: string; shared?: boolean },
): Promise<VoicePrompt | null> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT id, person_id, kind, name, prompt, shared FROM voice_prompts WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .get(id, owner.workspaceId, owner.personId)) as PromptRow | undefined;
  if (!row) return null;
  const next = {
    name: input.name !== undefined ? input.name.trim().slice(0, 80) || row.name : row.name,
    prompt: input.prompt !== undefined ? input.prompt.trim().slice(0, 4000) || row.prompt : row.prompt,
    shared: input.shared !== undefined ? (input.shared ? 1 : 0) : Number(row.shared),
  };
  await db
    .prepare('UPDATE voice_prompts SET name = ?, prompt = ?, shared = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .run(next.name, next.prompt, next.shared, nowIso(), id, owner.workspaceId, owner.personId);
  return toPrompt({ ...row, ...next }, owner.personId);
}

export async function deletePrompt(owner: VoiceOwner, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM voice_prompts WHERE id = ? AND workspace_id = ? AND person_id = ?')
    .run(id, owner.workspaceId, owner.personId);
  return res.changes > 0;
}

// ---------- Ajustes del workspace ----------

export function normalizeWorkspaceSettings(raw: unknown): VoiceWorkspaceSettings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<VoiceWorkspaceSettings>;
  return {
    retentionDays: (VOICE_RETENTION_DAYS as readonly number[]).includes(Number(v.retentionDays))
      ? Number(v.retentionDays)
      : DEFAULT_VOICE_WORKSPACE_SETTINGS.retentionDays,
  };
}

export async function getWorkspaceSettings(workspaceId: string): Promise<VoiceWorkspaceSettings> {
  const row = (await getDb().prepare('SELECT settings FROM voice_workspace_settings WHERE workspace_id = ?').get(workspaceId)) as
    | { settings: string }
    | undefined;
  let parsed: unknown = {};
  try {
    parsed = row ? JSON.parse(row.settings) : {};
  } catch {
    parsed = {};
  }
  return normalizeWorkspaceSettings(parsed);
}

export async function saveWorkspaceSettings(workspaceId: string, by: string, patch: Partial<VoiceWorkspaceSettings>): Promise<VoiceWorkspaceSettings> {
  const next = normalizeWorkspaceSettings({ ...(await getWorkspaceSettings(workspaceId)), ...patch });
  await getDb()
    .prepare(
      `INSERT INTO voice_workspace_settings (workspace_id, settings, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(workspaceId, JSON.stringify(next), by, nowIso());
  return next;
}

// ---------- Uso del equipo ----------

export interface TeamUsageRow {
  personId: string;
  name: string;
  email: string;
  dictations: number;
  words: number;
  dictationMinutes: number;
  meetings: number;
  meetingMinutes: number;
  lastActive: string | null;
  /** Apps donde más dicta (ruta de la app o "desktop"). */
  topApps: Array<{ app: string; words: number }>;
}

/** Ruta de la app → nombre corto ("/en/app/crm/contacts" → "crm"). */
export function appOf(sourceApp: string, capture: string): string {
  if (capture === 'desktop') return 'desktop';
  const m = /^\/(?:(?:en|es|pt)\/)?app\/([a-z-]+)/.exec(sourceApp);
  return m ? m[1] : 'other';
}

/**
 * Uso de Voice por persona en los últimos `days` días (panel de admin, como
 * los paneles de equipo de Wispr Flow). Solo números: nunca el texto de los
 * dictados ni de las reuniones, que son privados.
 */
export async function teamUsage(workspaceId: string, days = 30, now = new Date()): Promise<TeamUsageRow[]> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = (await getDb()
    .prepare(
      `SELECT person_id, kind, capture, source_app, COUNT(*) AS n, COALESCE(SUM(words), 0) AS words,
         COALESCE(SUM(duration_ms), 0) AS ms, MAX(started_at) AS last
       FROM voice_sessions WHERE workspace_id = ? AND started_at >= ?
       GROUP BY person_id, kind, capture, source_app`,
    )
    .all(workspaceId, since)) as Array<{ person_id: string; kind: string; capture: string; source_app: string; n: number; words: number; ms: number; last: string }>;
  const members = await listBoardMembers(workspaceId);
  const out = new Map<string, TeamUsageRow & { apps: Map<string, number> }>();
  for (const m of members) {
    out.set(m.id, {
      personId: m.id,
      name: m.name ?? '',
      email: m.email,
      dictations: 0,
      words: 0,
      dictationMinutes: 0,
      meetings: 0,
      meetingMinutes: 0,
      lastActive: null,
      topApps: [],
      apps: new Map(),
    });
  }
  for (const r of rows) {
    const row = out.get(r.person_id);
    // Quien ya no está en el workspace no aparece.
    if (!row) continue;
    if (r.kind === 'dictation') {
      row.dictations += Number(r.n);
      row.words += Number(r.words);
      row.dictationMinutes += Number(r.ms) / 60_000;
      const app = appOf(r.source_app, r.capture);
      row.apps.set(app, (row.apps.get(app) ?? 0) + Number(r.words));
    } else {
      row.meetings += Number(r.n);
      row.meetingMinutes += Number(r.ms) / 60_000;
    }
    if (!row.lastActive || r.last > row.lastActive) row.lastActive = r.last;
  }
  return [...out.values()]
    .map(({ apps, ...r }) => ({
      ...r,
      dictationMinutes: Math.round(r.dictationMinutes),
      meetingMinutes: Math.round(r.meetingMinutes),
      topApps: [...apps.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([app, words]) => ({ app, words })),
    }))
    .sort((a, b) => b.words + b.meetingMinutes * 100 - (a.words + a.meetingMinutes * 100) || a.email.localeCompare(b.email));
}

/** Apps donde más dicta una persona (para su propio panel de uso). */
export async function myTopApps(owner: VoiceOwner, days = 30, now = new Date()): Promise<Array<{ app: string; words: number }>> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = (await getDb()
    .prepare(
      `SELECT capture, source_app, COALESCE(SUM(words), 0) AS words FROM voice_sessions
       WHERE workspace_id = ? AND person_id = ? AND kind = 'dictation' AND started_at >= ? GROUP BY capture, source_app`,
    )
    .all(owner.workspaceId, owner.personId, since)) as Array<{ capture: string; source_app: string; words: number }>;
  const apps = new Map<string, number>();
  for (const r of rows) {
    const app = appOf(r.source_app, r.capture);
    apps.set(app, (apps.get(app) ?? 0) + Number(r.words));
  }
  return [...apps.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([app, words]) => ({ app, words }));
}
