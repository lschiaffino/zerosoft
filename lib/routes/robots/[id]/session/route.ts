import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { clearRobotSession } from '@/lib/robots';
import { canEditRobots, forbidden, notFound, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Borrar sesión": descarta cookies y localStorage guardados del robot. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  if (!(await clearRobotSession(user.id, id))) return notFound();
  return NextResponse.json({ ok: true });
}
