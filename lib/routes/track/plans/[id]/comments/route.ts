import type { NextRequest } from 'next/server';
import { entityCommentRoutes } from '@/lib/track-entity-comments-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Hilo de comentarios del project (lib/track-entity-comments). */
export async function GET(req: NextRequest, props: Props) {
  return entityCommentRoutes('plan').list(req, props);
}

export async function POST(req: NextRequest, props: Props) {
  return entityCommentRoutes('plan').create(req, props);
}
