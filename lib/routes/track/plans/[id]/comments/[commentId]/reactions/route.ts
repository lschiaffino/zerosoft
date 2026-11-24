import type { NextRequest } from 'next/server';
import { entityCommentRoutes } from '@/lib/track-entity-comments-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string; commentId: string }> };

/** Poner o sacar una reacción en un comentario del project. */
export async function POST(req: NextRequest, props: Props) {
  return entityCommentRoutes('plan').react(req, props);
}
