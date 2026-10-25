import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { canSeeView, getSavedView, setViewFavorite } from '@/lib/track-ux';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ favorite: z.boolean() });

/** Marca o desmarca una vista (propia o de equipo) como favorita: aparece en el sidebar. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const me = realUserId(user);
  const view = await getSavedView(params.id, me);
  if (!view || !canSeeView(view, me)) return notFound();
  const project = await getProject(view.project_id);
  if (!project || !canAccessTrackProject(project, user.team?.id ?? null, user.id)) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  await setViewFavorite(view.id, me, parsed.data.favorite);
  return NextResponse.json(await getSavedView(view.id, me));
}
