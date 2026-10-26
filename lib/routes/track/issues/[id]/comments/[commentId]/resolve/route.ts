import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getAccessibleIssue } from '@/lib/track-data';
import { commentResolveSchema } from '@/lib/track-schema';
import { getComment, setThreadResolved } from '@/lib/track-ux';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; commentId: string }> };

/** Resuelve o reabre el hilo de un comentario raíz (cualquier miembro, como en Linear). */
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const comment = await getComment(found.issue.id, params.commentId);
  if (!comment) return notFound();
  if (comment.parent_id) return trackError(400, 'not_thread_root');

  const body: unknown = await req.json().catch(() => null);
  const parsed = commentResolveSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  await setThreadResolved(comment.id, realUserId(user), parsed.data.resolved);
  return NextResponse.json({ ok: true, resolved: parsed.data.resolved });
}
