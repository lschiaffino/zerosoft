import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { unenrollRun } from '@/lib/crm-workflows';
import { notFound, unauthorized, forbidden } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Saca el registro del workflow (W3): solo owner y admins, y solo una inscripción que sigue activa. */
export async function DELETE(_req: Request, props: { params: Promise<{ id: string; runId: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  if (!(await unenrollRun(user.id, params.id, params.runId, realUserId(user)))) return notFound();
  return new NextResponse(null, { status: 204 });
}
