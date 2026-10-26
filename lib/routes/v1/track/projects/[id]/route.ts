import { apiGetProject, apiProjectUpdateSchema, apiUpdateProject, parseOrThrow } from '@/lib/track-api-ops';
import { jsonBody, trackApiRoute } from '@/lib/track-api-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Proyecto por id o clave (WEB), con sus status. */
export async function GET(req: Request, props: Props) {
  const { id } = await props.params;
  return trackApiRoute(req, 'track:read', (ctx) => apiGetProject(ctx, id));
}

export async function PATCH(req: Request, props: Props) {
  const { id } = await props.params;
  return trackApiRoute(req, 'track:write', async (ctx) => apiUpdateProject(ctx, id, parseOrThrow(apiProjectUpdateSchema, await jsonBody(req))));
}
