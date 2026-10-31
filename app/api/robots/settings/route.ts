import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { getRobotWorkspaceConfig, maxWorkspaceConcurrency, setRobotWorkspaceConfig } from '@/lib/robots';
import { canEditRobots, forbidden, robotError, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  concurrency: z.number().int().min(1).max(50).optional(),
  membersCanBuild: z.boolean().optional(),
});

/** Ajustes de Robots del workspace: los ve cualquiera que use la app. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ ...(await getRobotWorkspaceConfig(user.id)), maxConcurrency: maxWorkspaceConcurrency(), canEdit: canEditRobots(user) });
}

/** Solo admins: cambian cuánto se gasta a la vez y quién puede armar robots. */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'invalid_input');
  if (parsed.data.concurrency !== undefined && parsed.data.concurrency > maxWorkspaceConcurrency()) return robotError(400, 'invalid_input');
  return NextResponse.json(await setRobotWorkspaceConfig(user.id, parsed.data));
}
