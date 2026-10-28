/**
 * Talk: secciones propias del sidebar (como las de Slack). Cada persona crea
 * las suyas, mueve canales y DMs adentro, elige el orden (alfabético o por
 * actividad) y las ordena entre sí. Son de la persona: nadie más las ve.
 * Server-only.
 */
import { getDb } from './db';
import { TalkError, emitTalkEvent, getMembership, getChannelRow, nowIso, type TalkActor } from './talk';

export const MAX_SECTIONS = 30;

export interface TalkSectionDto {
  id: string;
  name: string;
  position: number;
  sort: 'alpha' | 'recent';
  channelIds: string[];
}

export async function listSections(actor: TalkActor): Promise<TalkSectionDto[]> {
  const db = getDb();
  const rows = (await db.prepare('SELECT id, name, position, sort FROM talk_sections WHERE workspace_id = ? AND user_id = ? ORDER BY position, created_at').all(actor.workspaceId, actor.personId)) as Array<{
    id: string;
    name: string;
    position: number;
    sort: 'alpha' | 'recent';
  }>;
  if (!rows.length) return [];
  const items = (await db
    .prepare(
      `SELECT si.section_id, si.channel_id FROM talk_section_items si JOIN talk_members m ON m.channel_id = si.channel_id AND m.user_id = si.user_id
       WHERE si.user_id = ? AND si.section_id IN (SELECT id FROM talk_sections WHERE workspace_id = ? AND user_id = ?)`,
    )
    .all(actor.personId, actor.workspaceId, actor.personId)) as Array<{ section_id: string; channel_id: string }>;
  return rows.map((r) => ({ id: r.id, name: r.name, position: Number(r.position), sort: r.sort, channelIds: items.filter((i) => i.section_id === r.id).map((i) => i.channel_id) }));
}

async function ownSection(actor: TalkActor, id: string) {
  const row = await getDb().prepare('SELECT id FROM talk_sections WHERE id = ? AND workspace_id = ? AND user_id = ?').get(id, actor.workspaceId, actor.personId);
  if (!row) throw new TalkError('not_found', 404);
}

const changed = (actor: TalkActor) => emitTalkEvent(actor.workspaceId, 'section', { userId: actor.personId, actorId: actor.personId });

export async function createSection(actor: TalkActor, name: string): Promise<TalkSectionDto> {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new TalkError('invalid_name');
  const db = getDb();
  const n = (await db.prepare('SELECT COUNT(*) AS n, MAX(position) AS p FROM talk_sections WHERE workspace_id = ? AND user_id = ?').get(actor.workspaceId, actor.personId)) as { n: number; p: number | null };
  if (Number(n.n) >= MAX_SECTIONS) throw new TalkError('too_many_sections', 409);
  const id = crypto.randomUUID();
  const position = Number(n.p ?? -1) + 1;
  await db.prepare("INSERT INTO talk_sections (id, workspace_id, user_id, name, position, sort, created_at) VALUES (?, ?, ?, ?, ?, 'alpha', ?)").run(id, actor.workspaceId, actor.personId, clean, position, nowIso());
  await changed(actor);
  return { id, name: clean, position, sort: 'alpha', channelIds: [] };
}

export async function updateSection(actor: TalkActor, id: string, input: { name?: string; sort?: 'alpha' | 'recent'; move?: -1 | 1 }): Promise<void> {
  await ownSection(actor, id);
  const db = getDb();
  if (input.name !== undefined) {
    const clean = input.name.trim().slice(0, 60);
    if (!clean) throw new TalkError('invalid_name');
    await db.prepare('UPDATE talk_sections SET name = ? WHERE id = ?').run(clean, id);
  }
  if (input.sort) await db.prepare('UPDATE talk_sections SET sort = ? WHERE id = ?').run(input.sort, id);
  if (input.move) {
    const list = await listSections(actor);
    const i = list.findIndex((s) => s.id === id);
    const j = i + input.move;
    if (i >= 0 && j >= 0 && j < list.length) {
      [list[i], list[j]] = [list[j], list[i]];
      for (const [k, s] of list.entries()) await db.prepare('UPDATE talk_sections SET position = ? WHERE id = ?').run(k, s.id);
    }
  }
  await changed(actor);
}

/** Borra la sección: sus canales vuelven a Canales / Mensajes directos. */
export async function deleteSection(actor: TalkActor, id: string): Promise<void> {
  await ownSection(actor, id);
  await getDb().prepare('DELETE FROM talk_sections WHERE id = ?').run(id);
  await changed(actor);
}

/** Mueve un canal o DM a una sección (null = sacarlo de la sección). */
export async function moveToSection(actor: TalkActor, channelId: string, sectionId: string | null): Promise<void> {
  const channel = await getChannelRow(actor.workspaceId, channelId);
  if (!channel || !(await getMembership(channelId, actor.personId))) throw new TalkError('not_found', 404);
  const db = getDb();
  if (sectionId === null) {
    await db.prepare('DELETE FROM talk_section_items WHERE user_id = ? AND channel_id = ?').run(actor.personId, channelId);
  } else {
    await ownSection(actor, sectionId);
    await db
      .prepare('INSERT INTO talk_section_items (user_id, channel_id, section_id) VALUES (?, ?, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET section_id = excluded.section_id')
      .run(actor.personId, channelId, sectionId);
  }
  await changed(actor);
}
