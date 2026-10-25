import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  DOC_INTERNAL_WRITE,
  deleteDocComment,
  getDocAccess,
  getDocComment,
  getDocPageRow,
  setDocCommentResolved,
} from '@/lib/docs';
import { docCommentUpdateSchema } from '@/lib/docs-schema';
import { forbidden, invalidBody, notFound, unauthorized } from '@/lib/docs-http';
import { canCommentAccess } from '@/lib/docs-access';

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
  // Comentar, resolver y borrar: "puede comentar" o más (ver no alcanza).
  const access = await getDocAccess(page, user, DOC_INTERNAL_WRITE);
  if (!access) return notFound();
  if (!canCommentAccess(access)) return forbidden();

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
  // Mismo acceso que para comentar: sin acceso a la página (p. ej. un share
  // revocado) tampoco se pueden borrar los comentarios propios.
  // Comentar, resolver y borrar: "puede comentar" o más (ver no alcanza).
  const access = await getDocAccess(page, user, DOC_INTERNAL_WRITE);
  if (!access) return notFound();
  if (!canCommentAccess(access)) return forbidden();

  const comment = await getDocComment(params.commentId);
  if (!comment || comment.page_id !== params.id) return notFound();

  // Solo el autor del comentario o el dueño de la página puede borrarlo.
  const actorId = user.actingUser?.id ?? user.id;
  const isPageOwner = access === 'owner';
  if (comment.user_id !== actorId && !isPageOwner) return notFound();

  if (!(await deleteDocComment(params.commentId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
