import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { handleScenePut } from '@/lib/board-scene-http';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Guarda la escena (autosave). Body: { version, scene, thumbnail? }.
 * 409 si la pizarra cambió en otro lado desde `version`; 413 si es muy grande.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await requireBoardAccess(user, id, 'edit');
  if (isDenied(access)) return access;
  const { workspaceId, personId } = access.viewer;
  const limited = await limitWrites('boards:scene', personId, 120);
  if (limited) return limited;
  return handleScenePut(req, workspaceId, personId, id);
}
