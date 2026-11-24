import type { NextRequest } from 'next/server';
import { entityCommentRoutes } from '@/lib/track-entity-comments-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string; commentId: string }> };

/** Resolver o reabrir un hilo del iniciativa. */
export async function POST(req: NextRequest, props: Props) {
  return entityCommentRoutes('initiative').resolve(req, props);
}
