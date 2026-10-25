import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessTrackProject, deleteIssueView, getProject, updateIssueView } from '@/lib/track-data';
import { canSeeView, getSavedView, setViewShared } from '@/lib/track-ux';
import type { SessionUser } from '@/lib/session';
import { issueViewUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * La vista se ve si es propia o de equipo y la persona accede al proyecto;
 * editarla o borrarla es solo de quien la creó (`own`).
 */
async function accessibleView(id: string, user: SessionUser, own: boolean) {
  const me = realUserId(user);
  const view = await getSavedView(id, me);
  if (!view || !canSeeView(view, me)) return null;
  if (own && view.user_id !== me) return null;
  const project = await getProject(view.project_id);
  if (!project || !canAccessTrackProject(project, user.team?.id ?? null, user.id)) return null;
  return view;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const view = await accessibleView(params.id, user, false);
  if (!view) return notFound();

  return NextResponse.json(view);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const view = await accessibleView(params.id, user, true);
  if (!view) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = issueViewUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const { shared, ...rest } = parsed.data;
  if (Object.values(rest).some((v) => v !== undefined)) await updateIssueView(params.id, rest);
  if (shared !== undefined) await setViewShared(params.id, shared);
  return NextResponse.json(await getSavedView(params.id, realUserId(user)));
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const view = await accessibleView(params.id, user, true);
  if (!view) return notFound();

  await deleteIssueView(params.id);
  return NextResponse.json({ ok: true });
}
