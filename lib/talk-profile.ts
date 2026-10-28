/**
 * Talk: perfiles como los de Slack. Cada persona carga cargo, pronombres,
 * teléfono y zona horaria (se ve su hora local), y el admin del workspace
 * define campos propios (p. ej. "Equipo", "Oficina") que cada uno completa.
 * Un invitado solo ve los perfiles de quienes comparten canal con él.
 * Server-only.
 */
import { getDb } from './db';
import { roleAtLeast } from './teams';
import { TalkError, emitTalkEvent, nowIso, sharedPeople, workspacePersonKind, type TalkActor } from './talk';
import { validTimeZone } from './talk-quiet';

export interface TalkProfileField {
  id: string;
  label: string;
}

export interface TalkProfileDto {
  userId: string;
  title: string;
  pronouns: string;
  phone: string;
  timezone: string;
  /** Valores de los campos del workspace, por id de campo. */
  fields: Record<string, string>;
}

export const MAX_PROFILE_FIELDS = 12;

function parseFields(raw: string): Record<string, string> {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string' && val) out[k] = val;
    return out;
  } catch {
    return {};
  }
}

export async function listProfileFields(workspaceId: string): Promise<TalkProfileField[]> {
  return ((await getDb().prepare('SELECT id, label FROM talk_profile_fields WHERE workspace_id = ? ORDER BY position, created_at').all(workspaceId)) as Array<{
    id: string;
    label: string;
  }>).map((r) => ({ id: r.id, label: r.label }));
}

/** Perfiles que esta persona ve (todo el workspace; un invitado, solo los de sus canales). */
export async function listProfiles(actor: TalkActor): Promise<TalkProfileDto[]> {
  const fields = new Set((await listProfileFields(actor.workspaceId)).map((f) => f.id));
  const rows = (await getDb().prepare('SELECT * FROM talk_profiles WHERE workspace_id = ?').all(actor.workspaceId)) as Array<{
    user_id: string;
    title: string;
    pronouns: string;
    phone: string;
    timezone: string;
    fields: string;
  }>;
  const visible = actor.guest ? await sharedPeople(actor) : null;
  return rows
    .filter((r) => !visible || visible.has(r.user_id))
    .map((r) => {
      const values = parseFields(r.fields);
      return {
        userId: r.user_id,
        title: r.title,
        pronouns: r.pronouns,
        phone: r.phone,
        timezone: r.timezone,
        fields: Object.fromEntries(Object.entries(values).filter(([k]) => fields.has(k))),
      };
    });
}

export interface ProfileInput {
  title?: string;
  pronouns?: string;
  phone?: string;
  timezone?: string;
  fields?: Record<string, string>;
}

export async function updateMyProfile(actor: TalkActor, input: ProfileInput): Promise<TalkProfileDto> {
  if (!(await workspacePersonKind(actor.workspaceId, actor.personId))) throw new TalkError('not_found', 404);
  if (input.timezone !== undefined && input.timezone !== '' && !validTimeZone(input.timezone)) throw new TalkError('invalid_timezone');
  if (input.phone !== undefined && input.phone && !/^[+\d\s().-]{3,32}$/.test(input.phone)) throw new TalkError('invalid_phone');
  const db = getDb();
  const now = nowIso();
  await db.prepare('INSERT OR IGNORE INTO talk_profiles (workspace_id, user_id, updated_at) VALUES (?, ?, ?)').run(actor.workspaceId, actor.personId, now);
  const cur = (await db.prepare('SELECT * FROM talk_profiles WHERE workspace_id = ? AND user_id = ?').get(actor.workspaceId, actor.personId)) as {
    title: string;
    pronouns: string;
    phone: string;
    timezone: string;
    fields: string;
  };
  let fields = parseFields(cur.fields);
  if (input.fields) {
    const allowed = new Set((await listProfileFields(actor.workspaceId)).map((f) => f.id));
    fields = { ...fields };
    for (const [k, v] of Object.entries(input.fields)) {
      if (!allowed.has(k)) continue;
      const val = String(v ?? '').trim().slice(0, 200);
      if (val) fields[k] = val;
      else delete fields[k];
    }
  }
  const next = {
    title: input.title !== undefined ? input.title.trim().slice(0, 100) : cur.title,
    pronouns: input.pronouns !== undefined ? input.pronouns.trim().slice(0, 40) : cur.pronouns,
    phone: input.phone !== undefined ? input.phone.trim().slice(0, 32) : cur.phone,
    timezone: input.timezone !== undefined ? input.timezone : cur.timezone,
  };
  await db
    .prepare('UPDATE talk_profiles SET title = ?, pronouns = ?, phone = ?, timezone = ?, fields = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?')
    .run(next.title, next.pronouns, next.phone, next.timezone, JSON.stringify(fields), now, actor.workspaceId, actor.personId);
  await emitTalkEvent(actor.workspaceId, 'profile', { actorId: actor.personId, payload: { userId: actor.personId } });
  return { userId: actor.personId, ...next, fields };
}

/** El admin reemplaza la lista de campos (los que no vienen se borran; los valores viejos quedan ocultos). */
export async function setProfileFields(actor: TalkActor, input: Array<{ id?: string; label: string }>): Promise<TalkProfileField[]> {
  if (actor.guest || !roleAtLeast(actor.role, 'admin')) throw new TalkError('forbidden', 403);
  const clean = input.map((f) => ({ id: f.id, label: f.label.trim().slice(0, 60) })).filter((f) => f.label);
  if (clean.length > MAX_PROFILE_FIELDS) throw new TalkError('too_many_fields');
  const db = getDb();
  const existing = new Set((await listProfileFields(actor.workspaceId)).map((f) => f.id));
  const keep = new Set<string>();
  const now = nowIso();
  for (const [i, f] of clean.entries()) {
    if (f.id && existing.has(f.id)) {
      keep.add(f.id);
      await db.prepare('UPDATE talk_profile_fields SET label = ?, position = ? WHERE id = ? AND workspace_id = ?').run(f.label, i, f.id, actor.workspaceId);
    } else {
      const id = crypto.randomUUID();
      keep.add(id);
      await db.prepare('INSERT INTO talk_profile_fields (id, workspace_id, label, position, created_at) VALUES (?, ?, ?, ?, ?)').run(id, actor.workspaceId, f.label, i, now);
    }
  }
  for (const id of existing) if (!keep.has(id)) await db.prepare('DELETE FROM talk_profile_fields WHERE id = ? AND workspace_id = ?').run(id, actor.workspaceId);
  await emitTalkEvent(actor.workspaceId, 'profile', { actorId: actor.personId, payload: { fields: true } });
  return listProfileFields(actor.workspaceId);
}
