/**
 * Design → Board: manda una página exportada (PNG, armado en el navegador)
 * a una pizarra como imagen, al lado de lo que ya tiene. Server-only.
 * Pide edición en la pizarra con el mismo chequeo de acceso que Board.
 */
import { randomBytes } from 'crypto';
import { accessAtLeast, boardViewer, getBoardAccess } from './board-access';
import { BOARD_MAX_FILE_BYTES } from './board-file-refs';
import { getBoard, listBoards, saveBoardScene } from './boards';
import { publishBoardEvent } from './board-live';
import type { SessionUser } from './session';

export class DesignBoardError extends Error {
  constructor(
    public code: 'not_found' | 'forbidden' | 'invalid_input' | 'too_large' | 'conflict',
    public status: number,
  ) {
    super(code);
  }
}

const PNG_DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

/** Pizarras donde la persona puede agregar (edición o más). */
export async function editableBoards(user: SessionUser): Promise<Array<{ id: string; name: string }>> {
  const viewer = boardViewer(user);
  const boards = await listBoards(user.id, viewer);
  const out: Array<{ id: string; name: string }> = [];
  for (const b of boards.slice(0, 200)) {
    const level = await getBoardAccess(viewer, b.id);
    if (accessAtLeast(level, 'edit')) out.push({ id: b.id, name: b.name });
  }
  return out;
}

export async function addImageToBoard(
  user: SessionUser,
  boardId: string,
  input: { dataUrl: string; width: number; height: number },
): Promise<{ version: number }> {
  if (!PNG_DATA_URL.test(input.dataUrl)) throw new DesignBoardError('invalid_input', 400);
  // base64 → bytes ≈ 3/4 del largo.
  if ((input.dataUrl.length * 3) / 4 > BOARD_MAX_FILE_BYTES) throw new DesignBoardError('too_large', 413);
  const viewer = boardViewer(user);
  const level = await getBoardAccess(viewer, boardId);
  if (!level) throw new DesignBoardError('not_found', 404);
  if (!accessAtLeast(level, 'edit')) throw new DesignBoardError('forbidden', 403);
  const personId = user.actingUser?.id ?? user.id;
  const mime = input.dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  // En la pizarra entra con un ancho razonable (como mucho 800).
  const k = Math.min(1, 800 / Math.max(1, input.width));
  const w = Math.max(1, Math.round(input.width * k));
  const h = Math.max(1, Math.round(input.height * k));
  for (let attempt = 0; attempt < 3; attempt++) {
    const board = await getBoard(user.id, boardId);
    if (!board) throw new DesignBoardError('not_found', 404);
    const live = (board.scene.elements as Array<{ x?: number; y?: number; width?: number; isDeleted?: boolean }>).filter((e) => !e.isDeleted);
    const right = live.length ? Math.max(...live.map((e) => Number(e.x ?? 0) + Number(e.width ?? 0))) : 0;
    const top = live.length ? Math.min(...live.map((e) => Number(e.y ?? 0))) : 0;
    const fileId = `design${randomBytes(10).toString('hex')}`;
    const el = {
      id: randomBytes(10).toString('base64url'),
      type: 'image',
      x: live.length ? right + 120 : 0,
      y: top,
      width: w,
      height: h,
      angle: 0,
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: Math.floor(Math.random() * 2 ** 31),
      version: 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      status: 'saved',
      fileId,
      scale: [1, 1],
      crop: null,
    };
    const files = { ...(board.scene.files ?? {}), [fileId]: { id: fileId, mimeType: mime, dataURL: input.dataUrl, created: Date.now() } };
    const res = await saveBoardScene(user.id, personId, boardId, { ...board.scene, elements: [...board.scene.elements, el], files }, board.version);
    if (res.ok) {
      await publishBoardEvent({ boardId, workspaceId: user.id, socketId: 'server', kind: 'saved', user: { id: personId, name: null, guest: false }, payload: { version: res.version } }).catch(
        () => undefined,
      );
      return { version: res.version };
    }
    if (res.code === 'too_large') throw new DesignBoardError('too_large', 413);
    if (res.code === 'not_found') throw new DesignBoardError('not_found', 404);
  }
  throw new DesignBoardError('conflict', 409);
}
