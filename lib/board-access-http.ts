import type { NextResponse } from 'next/server';
import { jsonError } from './write-limit';
import { accessAtLeast, boardViewer, getBoardAccess, type BoardAccessLevel, type BoardViewer } from './board-access';
import type { TeamRole } from './teams';

type SessionLike = { id: string; actingUser?: { id: string } | null; role?: TeamRole };

/**
 * Chequeo de acceso de las rutas /api/boards/[id]/…: 401 sin sesión, 404 si
 * no existe o no la puede ver (no se confirma que exista) y 403 si la ve pero
 * le falta el nivel pedido.
 */
export async function requireBoardAccess(
  user: SessionLike | null,
  boardId: string,
  need: BoardAccessLevel,
): Promise<{ viewer: BoardViewer; level: BoardAccessLevel } | NextResponse> {
  if (!user) return jsonError(401, 'unauthorized');
  const viewer = boardViewer(user);
  const level = await getBoardAccess(viewer, boardId);
  if (!level) return jsonError(404, 'not_found');
  if (!accessAtLeast(level, need)) return jsonError(403, 'forbidden');
  return { viewer, level };
}

export function isDenied(v: unknown): v is NextResponse {
  return v instanceof Response;
}
