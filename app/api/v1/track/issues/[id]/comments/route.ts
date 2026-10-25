import { apiAddComment, apiCommentSchema, apiListComments, parseOrThrow } from '@/lib/track-api-ops';
import { jsonBody, trackApiRoute } from '@/lib/track-api-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function GET(req: Request, props: Props) {
  const { id } = await props.params;
  return trackApiRoute(req, 'track:read', (ctx) => apiListComments(ctx, id));
}

/** Comenta como la persona dueña de la key (avisa a suscriptos y menciones). */
export async function POST(req: Request, props: Props) {
  const { id } = await props.params;
  return trackApiRoute(req, 'track:write', async (ctx) => apiAddComment(ctx, id, parseOrThrow(apiCommentSchema, await jsonBody(req))), 201);
}
