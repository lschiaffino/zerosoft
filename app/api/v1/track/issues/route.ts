import { apiCreateIssue, apiIssueCreateSchema, apiIssueListSchema, apiListIssues, parseOrThrow } from '@/lib/track-api-ops';
import { jsonBody, queryObject, trackApiRoute } from '@/lib/track-api-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Issues que ve la key, con filtros y paginación. */
export async function GET(req: Request) {
  return trackApiRoute(req, 'track:read', (ctx) => apiListIssues(ctx, parseOrThrow(apiIssueListSchema, queryObject(req))));
}

/** Crea un issue (pasa por triage si el proyecto lo tiene activo). */
export async function POST(req: Request) {
  return trackApiRoute(req, 'track:write', async (ctx) => apiCreateIssue(ctx, parseOrThrow(apiIssueCreateSchema, await jsonBody(req))), 201);
}
