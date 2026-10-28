/**
 * Talk: canvas del canal (como el canvas de canal de Slack). Un documento por
 * canal o DM, con el editor de bloques de Docs en modo embebido (el mismo que
 * usa Notes): títulos, listas, tareas, tablas, toggles, código, callouts.
 *
 * Lo lee quien lee el canal y lo edita quien es miembro (canal sin archivar).
 * Cada guardado sube `rev`: si otra persona guardó en el medio, el guardado
 * vuelve con 'canvas_conflict' y la pantalla recarga la versión nueva. Los
 * cambios llegan a las otras pestañas por el feed (evento 'canvas').
 * Server-only.
 */
import { getDb } from './db';
import type { DocsBlock } from './docs-types';
import { sanitizeBlocks } from './docs-sanitize';
import { blocksToText } from './notes-types';
import { TalkError, canManageChannel, emitTalkEvent, nowIso, readableChannel, writableChannel, type TalkActor } from './talk';

export const CANVAS_MAX_BLOCKS = 2000;
export const CANVAS_MAX_BYTES = 900_000;

export interface TalkCanvasDto {
  id: string;
  channelId: string;
  title: string;
  content: DocsBlock[];
  rev: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

type CanvasRow = { id: string; channel_id: string; title: string; content: string; rev: number; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string };

function parseBlocks(raw: string): DocsBlock[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as DocsBlock[]) : [];
  } catch {
    return [];
  }
}

/** El canvas del canal (null si todavía no tiene). */
export async function getCanvas(actor: TalkActor, channelId: string): Promise<TalkCanvasDto | null> {
  const access = await readableChannel(actor, channelId);
  if (!access) throw new TalkError('not_found', 404);
  const row = (await getDb().prepare('SELECT * FROM talk_canvases WHERE channel_id = ?').get(channelId)) as CanvasRow | undefined;
  if (!row) return null;
  const canEdit = !!access.member && !access.channel.archived_at;
  return {
    id: row.id,
    channelId: row.channel_id,
    title: row.title,
    content: parseBlocks(row.content),
    rev: Number(row.rev),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canEdit,
    canDelete: canEdit && (row.created_by === actor.personId || canManageChannel(actor, access.channel, access.member) || access.channel.kind === 'dm' || access.channel.kind === 'group'),
  };
}

/** Crea o guarda el canvas. `baseRev` es la versión sobre la que se editó (0 = crear). */
export async function saveCanvas(actor: TalkActor, channelId: string, input: { title?: string; content?: DocsBlock[]; baseRev: number }): Promise<TalkCanvasDto> {
  await writableChannel(actor, channelId);
  const db = getDb();
  const content = input.content ? sanitizeBlocks(input.content.slice(0, CANVAS_MAX_BLOCKS)) : null;
  const encoded = content ? JSON.stringify(content) : null;
  if (encoded && encoded.length > CANVAS_MAX_BYTES) throw new TalkError('canvas_too_large', 413);
  const title = input.title !== undefined ? input.title.trim().slice(0, 200) : undefined;
  const now = nowIso();
  const existing = (await db.prepare('SELECT id, rev FROM talk_canvases WHERE channel_id = ?').get(channelId)) as { id: string; rev: number } | undefined;
  if (!existing) {
    const id = crypto.randomUUID();
    const blocks = content ?? [{ id: crypto.randomUUID(), type: 'paragraph', content: '' } as DocsBlock];
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO talk_canvases (id, workspace_id, channel_id, title, content, body_text, rev, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(id, actor.workspaceId, channelId, title ?? '', JSON.stringify(blocks), blocksToText(blocks).slice(0, 100_000), actor.personId, actor.personId, now, now);
    if (!res.changes) throw new TalkError('canvas_conflict', 409);
  } else {
    // Compare-and-set por rev: dos personas guardando a la vez no se pisan sin saberlo.
    const sets = ['rev = rev + 1', 'updated_by = ?', 'updated_at = ?'];
    const args: Array<string | number> = [actor.personId, now];
    if (title !== undefined) {
      sets.push('title = ?');
      args.push(title);
    }
    if (content && encoded) {
      sets.push('content = ?', 'body_text = ?');
      args.push(encoded, blocksToText(content).slice(0, 100_000));
    }
    const res = await db.prepare(`UPDATE talk_canvases SET ${sets.join(', ')} WHERE id = ? AND rev = ?`).run(...args, existing.id, input.baseRev);
    if (!res.changes) throw new TalkError('canvas_conflict', 409);
  }
  const dto = (await getCanvas(actor, channelId))!;
  await emitTalkEvent(actor.workspaceId, 'canvas', { channelId, actorId: actor.personId, payload: { rev: dto.rev, change: existing ? 'updated' : 'created' } });
  return dto;
}

export async function deleteCanvas(actor: TalkActor, channelId: string): Promise<boolean> {
  const canvas = await getCanvas(actor, channelId);
  if (!canvas) return false;
  if (!canvas.canDelete) throw new TalkError('forbidden', 403);
  await getDb().prepare('DELETE FROM talk_canvases WHERE channel_id = ?').run(channelId);
  await emitTalkEvent(actor.workspaceId, 'canvas', { channelId, actorId: actor.personId, payload: { change: 'deleted' } });
  return true;
}
