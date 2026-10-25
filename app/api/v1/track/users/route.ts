import { apiListUsers } from '@/lib/track-api-ops';
import { queryObject, trackApiRoute } from '@/lib/track-api-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Personas que se pueden asignar (de un proyecto con ?projectId=, o de todos). */
export async function GET(req: Request) {
  const { projectId } = queryObject(req);
  return trackApiRoute(req, 'track:read', (ctx) => apiListUsers(ctx, projectId || undefined));
}
