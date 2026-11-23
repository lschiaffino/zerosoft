import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteRelease, getAccessibleRelease, listReleaseIssues, updateRelease } from '@/lib/track-releases';
import { releaseUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El release con sus issues (solo si la persona ve su team). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleRelease((await props.params).id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  return NextResponse.json({ release: found.release, issues: await listReleaseIssues(found.release.id) });
}

/** Renombrar, versión, fecha, estado, notas (null vuelve a las generadas) y la entrada automática de GitHub. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleRelease((await props.params).id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const parsed = releaseUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  await updateRelease(found.release.id, parsed.data);
  const again = await getAccessibleRelease(found.release.id, user.team?.id ?? null, user.id);
  return NextResponse.json(again?.release ?? null);
}

/** Borra el release; sus issues quedan sin release. Como cycles y milestones, solo admins. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleRelease((await props.params).id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  await deleteRelease(found.release.id);
  return NextResponse.json({ ok: true });
}
