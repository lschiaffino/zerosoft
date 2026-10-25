import { apiCreateProject, apiListProjects, apiProjectCreateSchema, parseOrThrow } from '@/lib/track-api-ops';
import { jsonBody, queryObject, trackApiRoute } from '@/lib/track-api-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = queryObject(req);
  return trackApiRoute(req, 'track:read', (ctx) => apiListProjects(ctx, { includeArchived: q.includeArchived === 'true' }));
}

export async function POST(req: Request) {
  return trackApiRoute(req, 'track:write', async (ctx) => apiCreateProject(ctx, parseOrThrow(apiProjectCreateSchema, await jsonBody(req))), 201);
}
