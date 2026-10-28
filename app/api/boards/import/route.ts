import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createBoard, deleteBoard, saveBoardScene } from '@/lib/boards';
import { parseExcalidrawFile } from '@/lib/board-import';
import { getBoardFolder } from '@/lib/board-folders';
import { emitEventSoon } from '@/lib/events';
import { logBoardAudit } from '@/lib/board-audit';
import { BOARD_MAX_SCENE_BYTES } from '@/lib/boards-types';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Importa un archivo .excalidraw como pizarra nueva. Body: { name, file, folderId? }
 * con `file` = el contenido del archivo (JSON). Las imágenes en base64 pasan al
 * storage como en cualquier guardado.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:import', personId, 60);
  if (limited) return limited;
  const max = BOARD_MAX_SCENE_BYTES + 512 * 1024;
  if (Number(req.headers.get('content-length') ?? 0) > max) return jsonError(413, 'scene_too_large');
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > max) return jsonError(413, 'scene_too_large');
  let body: { name?: unknown; file?: unknown; folderId?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return jsonError(400, 'invalid_input');
  }
  const scene = parseExcalidrawFile(body.file);
  if (!scene) return jsonError(400, 'invalid_file');
  const folderId = typeof body.folderId === 'string' && (await getBoardFolder(user.id, body.folderId)) ? body.folderId : null;
  const name = typeof body.name === 'string' ? body.name.replace(/\.(excalidraw|json)$/i, '').trim().slice(0, 120) : '';
  const board = await createBoard(user.id, personId, name || 'Imported board', { folderId });
  const saved = await saveBoardScene(user.id, personId, board.id, scene, board.version);
  if (!saved.ok) {
    await deleteBoard(user.id, board.id);
    return saved.code === 'too_large' ? jsonError(413, 'scene_too_large') : jsonError(400, 'invalid_file');
  }
  await logBoardAudit({ workspaceId: user.id, actorId: personId, action: 'board.imported', boardId: board.id, boardName: board.name, data: { elements: scene.elements.length } });
  await emitEventSoon(user.id, 'board.created', { board: { id: board.id, name: board.name }, createdBy: personId });
  return NextResponse.json({ ...board, version: saved.version }, { status: 201 });
}
