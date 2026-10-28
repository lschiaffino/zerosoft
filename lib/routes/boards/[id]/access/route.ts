import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { publishBoardAccessChanged } from '@/lib/board-live';
import { logBoardAudit } from '@/lib/board-audit';
import { getBoardAccessInfo, setBoardAccessMode, setBoardGuestLink, setBoardMember, type BoardAccessLevel } from '@/lib/board-access';
import { boardAccessPatchSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function payload(workspaceId: string, id: string, level: BoardAccessLevel) {
  const info = await getBoardAccessInfo(workspaceId, id);
  if (!info) return null;
  const manage = level === 'manage';
  return {
    mode: info.mode,
    level,
    created_by: info.created_by,
    members: info.members,
    // Candidatos y link de invitado: solo para quien gestiona el acceso.
    candidates: manage ? info.candidates : [],
    guest_token: manage ? info.guest_token : null,
  };
}

/** Acceso de la pizarra: modo e invitados (y, para quien lo gestiona, candidatos y link de invitado). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await requireBoardAccess(user, id, 'view');
  if (isDenied(access)) return access;
  const body = await payload(access.viewer.workspaceId, id, access.level);
  return body ? NextResponse.json(body) : jsonError(404, 'not_found');
}

/** Cambia el modo, invita/saca a alguien o prende/apaga el link de invitado. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await requireBoardAccess(user, id, 'manage');
  if (isDenied(access)) return access;
  const { workspaceId, personId } = access.viewer;
  const limited = await limitWrites('boards:access', personId, 60);
  if (limited) return limited;
  const parsed = boardAccessPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const { mode, member, guest } = parsed.data;
  if (mode && !(await setBoardAccessMode(workspaceId, id, mode))) return jsonError(404, 'not_found');
  if (member) {
    const res = await setBoardMember(workspaceId, id, member.userId, member.role, personId);
    if (res === 'not_found') return jsonError(404, 'not_found');
    if (res === 'not_member') return jsonError(400, 'not_member');
  }
  if (guest !== undefined && (await setBoardGuestLink(workspaceId, id, guest)) === false) return jsonError(404, 'not_found');
  // Las conexiones en vivo de la pizarra revalidan su acceso ya (quien lo perdió deja de recibir).
  await publishBoardAccessChanged(workspaceId, id);
  if (mode) await logBoardAudit({ workspaceId, actorId: personId, action: 'access.mode', boardId: id, data: { mode } });
  if (member) await logBoardAudit({ workspaceId, actorId: personId, action: 'access.member', boardId: id, data: { userId: member.userId, role: member.role } });
  if (guest !== undefined) await logBoardAudit({ workspaceId, actorId: personId, action: 'access.guest_link', boardId: id, data: { on: guest } });
  const body = await payload(workspaceId, id, access.level);
  return body ? NextResponse.json(body) : jsonError(404, 'not_found');
}
