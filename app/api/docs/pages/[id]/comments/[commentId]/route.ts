import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  canReadPage,
  deleteDocComment,
  getDocComment,
  getDocPageRow,
  setDocCommentResolved,
} from '@/lib/docs';
import { docCommentUpdateSchema } from '@/lib/docs-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; commentId: string }> }
) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const page = await getDocPageRow(params.id);
  if (!page) return notFound();
  if (!(await canReadPage(page, { id: user.id, actingUser: user.actingUser, team: user.team }))) {
    return notFound();
  }

  const comment = await getDocComment(params.commentId);
  if (!comment || comment.page_id !== params.id) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docCommentUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const updated = await setDocCommentResolved(params.commentId, parsed.data.resolved);
  if (!updated) return notFound();
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; commentId: string }> }
) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const page = await getDocPageRow(params.id);
  if (!page) return notFound();

  const comment = await getDocComment(params.commentId);
  if (!comment || comment.page_id !== params.id) return notFound();

  // Solo el autor del comentario o el dueño de la página puede borrarlo.
  const actorId = user.actingUser?.id ?? user.id;
  const isPageOwner = page.user_id === user.id;
  if (comment.user_id !== actorId && !isPageOwner) return notFound();

  if (!(await deleteDocComment(params.commentId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
