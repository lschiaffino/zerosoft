/**
 * Voice: compartir una reunión por link (como Granola). Server-only.
 *
 * Las reuniones siguen siendo privadas de quien graba. Un link para compartir
 * es explícito y revocable, y tiene un acceso:
 * - 'workspace': cualquier persona del workspace con sesión iniciada;
 * - 'people': solo las personas del workspace elegidas;
 * - 'anyone': cualquiera con el link, sin sesión.
 * El link muestra la nota (la de IA o, si no hay, la propia); la
 * transcripción solo si quien comparte la incluye (como Granola, por defecto
 * no). Siempre de solo lectura. Dejar de compartir borra el link: el token
 * viejo no vuelve a andar. Si quien compartió sale del workspace, el link de
 * workspace o personas deja de andar.
 */
import { randomBytes } from 'crypto';
import { getDb, getUserById } from './db';
import { isWorkspacePerson } from './crm-refs';
import { getSessionDetail, type VoiceOwner } from './voice';
import type { VoiceEnhanced, VoiceSegment, VoiceShareAccess, VoiceShareInfo } from './voice-types';

interface ShareRow {
  id: string;
  session_id: string;
  workspace_id: string;
  person_id: string;
  token: string;
  access: VoiceShareAccess;
  include_transcript: number;
  created_at: string;
}

const nowIso = () => new Date().toISOString();

export function isShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,64}$/.test(token);
}

async function ownedSession(owner: VoiceOwner, sessionId: string): Promise<boolean> {
  return !!(await getDb()
    .prepare("SELECT 1 AS x FROM voice_sessions WHERE id = ? AND workspace_id = ? AND person_id = ? AND kind = 'meeting'")
    .get(sessionId, owner.workspaceId, owner.personId));
}

async function sharePeople(shareId: string): Promise<VoiceShareInfo['people']> {
  return (await getDb()
    .prepare('SELECT u.id, u.name, u.email FROM voice_share_people p JOIN users u ON u.id = p.person_id WHERE p.share_id = ? ORDER BY p.created_at')
    .all(shareId)) as VoiceShareInfo['people'];
}

async function toInfo(row: ShareRow): Promise<VoiceShareInfo> {
  return {
    token: row.token,
    access: row.access,
    includeTranscript: !!Number(row.include_transcript),
    people: row.access === 'people' ? await sharePeople(row.id) : [],
    createdAt: row.created_at,
  };
}

export async function getShare(owner: VoiceOwner, sessionId: string): Promise<VoiceShareInfo | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM voice_shares WHERE session_id = ? AND workspace_id = ? AND person_id = ?')
    .get(sessionId, owner.workspaceId, owner.personId)) as ShareRow | undefined;
  return row ? toInfo(row) : null;
}

export type SetShareResult = { ok: true; share: VoiceShareInfo } | { ok: false; code: 'not_found' | 'not_member' };

/**
 * Crea el link (o cambia su acceso). `regenerate` cambia el token: el link
 * anterior deja de andar. Las personas tienen que ser del workspace.
 */
export async function setShare(
  owner: VoiceOwner,
  sessionId: string,
  input: { access: VoiceShareAccess; includeTranscript?: boolean; people?: string[]; regenerate?: boolean },
): Promise<SetShareResult> {
  if (!(await ownedSession(owner, sessionId))) return { ok: false, code: 'not_found' };
  const db = getDb();
  const people = [...new Set((input.people ?? []).filter((p) => p && p !== owner.personId))].slice(0, 50);
  for (const p of people) if (!(await isWorkspacePerson(owner.workspaceId, p))) return { ok: false, code: 'not_member' };
  const now = nowIso();
  const existing = (await db.prepare('SELECT * FROM voice_shares WHERE session_id = ?').get(sessionId)) as ShareRow | undefined;
  const token = !existing || input.regenerate ? randomBytes(18).toString('base64url') : existing.token;
  const include = input.includeTranscript ?? (existing ? !!Number(existing.include_transcript) : false);
  let id: string = existing?.id ?? '';
  if (existing) {
    await db
      .prepare('UPDATE voice_shares SET token = ?, access = ?, include_transcript = ?, updated_at = ? WHERE id = ?')
      .run(token, input.access, include ? 1 : 0, now, existing.id);
  } else {
    id = crypto.randomUUID();
    // Una sola fila por reunión (UNIQUE session_id): dos pedidos a la vez no crean dos links.
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO voice_shares (id, session_id, workspace_id, person_id, token, access, include_transcript, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, owner.workspaceId, owner.personId, token, input.access, include ? 1 : 0, now, now);
    if (!res.changes) return setShare(owner, sessionId, { ...input, regenerate: false });
  }
  if (input.people !== undefined || input.access !== 'people') {
    await db.prepare('DELETE FROM voice_share_people WHERE share_id = ?').run(id);
    if (input.access === 'people') {
      for (const p of people) {
        await db.prepare('INSERT OR IGNORE INTO voice_share_people (share_id, person_id, created_at) VALUES (?, ?, ?)').run(id, p, now);
      }
    }
  }
  const row = (await db.prepare('SELECT * FROM voice_shares WHERE id = ?').get(id)) as ShareRow;
  return { ok: true, share: await toInfo(row) };
}

/** Deja de compartir: borra el link (y a quiénes se había dado). */
export async function revokeShare(owner: VoiceOwner, sessionId: string): Promise<boolean> {
  const res = await getDb()
    .prepare('DELETE FROM voice_shares WHERE session_id = ? AND workspace_id = ? AND person_id = ?')
    .run(sessionId, owner.workspaceId, owner.personId);
  return res.changes > 0;
}

// ---------- Ver un link ----------

export interface SharedMeetingView {
  title: string;
  startedAt: string;
  durationMs: number;
  ownerName: string;
  enhanced: VoiceEnhanced | null;
  /** Solo si no hay nota con IA: lo que escribió la persona. */
  myNotes: string;
  segments: VoiceSegment[] | null;
  speakers: Record<string, string>;
  access: VoiceShareAccess;
}

export type ResolveShareResult = { state: 'not_found' } | { state: 'signin' } | { state: 'forbidden' } | { state: 'ok'; view: SharedMeetingView };

/**
 * Lo que ve quien abre el link. `viewerId` es la persona con sesión (su id
 * real, no el del workspace activo) o null sin sesión.
 */
export async function resolveShare(token: string, viewerId: string | null): Promise<ResolveShareResult> {
  if (!isShareToken(token)) return { state: 'not_found' };
  const db = getDb();
  const row = (await db.prepare('SELECT * FROM voice_shares WHERE token = ?').get(token)) as ShareRow | undefined;
  if (!row) return { state: 'not_found' };
  const isOwner = viewerId === row.person_id;
  if (row.access !== 'anyone' && !isOwner) {
    if (!viewerId) return { state: 'signin' };
    // Quien compartió tiene que seguir en el workspace, y quien mira también.
    if (!(await isWorkspacePerson(row.workspace_id, row.person_id))) return { state: 'not_found' };
    if (!(await isWorkspacePerson(row.workspace_id, viewerId))) return { state: 'forbidden' };
    if (row.access === 'people') {
      const allowed = await db.prepare('SELECT 1 AS x FROM voice_share_people WHERE share_id = ? AND person_id = ?').get(row.id, viewerId);
      if (!allowed) return { state: 'forbidden' };
    }
  }
  const d = await getSessionDetail({ workspaceId: row.workspace_id, personId: row.person_id }, row.session_id);
  if (!d) return { state: 'not_found' };
  const owner = await getUserById(row.person_id);
  return {
    state: 'ok',
    view: {
      title: d.title,
      startedAt: d.startedAt,
      durationMs: d.durationMs,
      ownerName: owner?.name || owner?.email || '',
      enhanced: d.enhanced ? { ...d.enhanced, sent: undefined } : null,
      myNotes: d.enhanced ? '' : d.myNotes,
      segments: Number(row.include_transcript) ? d.segments : null,
      speakers: d.speakers,
      access: row.access,
    },
  };
}

export interface SharedWithMe {
  token: string;
  title: string;
  startedAt: string;
  durationMs: number;
  ownerName: string;
  access: VoiceShareAccess;
}

/**
 * Reuniones que otras personas del workspace compartieron con todo el
 * workspace o con esta persona (el "espacio del equipo"). Las de "cualquiera
 * con el link" no se listan: solo las abre quien tiene el link.
 */
export async function listSharedWithMe(owner: VoiceOwner, opts: { q?: string | null; limit?: number } = {}): Promise<SharedWithMe[]> {
  const q = opts.q?.trim().toLowerCase();
  const rows = (await getDb()
    .prepare(
      `SELECT sh.token, sh.access, s.title, s.started_at, s.duration_ms, u.name, u.email, sh.person_id
       FROM voice_shares sh
       JOIN voice_sessions s ON s.id = sh.session_id
       LEFT JOIN users u ON u.id = sh.person_id
       WHERE sh.workspace_id = ? AND sh.person_id != ?
         AND (sh.access = 'workspace' OR (sh.access = 'people' AND EXISTS (SELECT 1 FROM voice_share_people p WHERE p.share_id = sh.id AND p.person_id = ?)))
       ORDER BY s.started_at DESC LIMIT ?`,
    )
    .all(owner.workspaceId, owner.personId, owner.personId, Math.min(opts.limit ?? 100, 200))) as Array<{
    token: string;
    access: VoiceShareAccess;
    title: string;
    started_at: string;
    duration_ms: number;
    name: string | null;
    email: string | null;
    person_id: string;
  }>;
  const out: SharedWithMe[] = [];
  for (const r of rows) {
    if (!(await isWorkspacePerson(owner.workspaceId, r.person_id))) continue;
    if (q && !r.title.toLowerCase().includes(q)) continue;
    out.push({ token: r.token, title: r.title, startedAt: r.started_at, durationMs: Number(r.duration_ms) || 0, ownerName: r.name || r.email || '', access: r.access });
  }
  return out;
}
