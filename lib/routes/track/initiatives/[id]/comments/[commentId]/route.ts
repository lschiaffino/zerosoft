import type { NextRequest } from 'next/server';
import { entityCommentRoutes } from '@/lib/track-entity-comments-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string; commentId: string }> };

/** Editar o borrar un comentario propio del iniciativa. */
export async function PATCH(req: NextRequest, props: Props) {
  return entityCommentRoutes('initiative').update(req, props);
}

export async function DELETE(req: NextRequest, props: Props) {
  return entityCommentRoutes('initiative').remove(req, props);
}
