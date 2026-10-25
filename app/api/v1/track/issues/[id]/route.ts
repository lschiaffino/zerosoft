import { apiDeleteIssue, apiGetIssue, apiIssueUpdateSchema, apiUpdateIssue, parseOrThrow } from '@/lib/track-api-ops';
import { jsonBody, trackApiRoute } from '@/lib/track-api-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Un issue por id o identificador (ZER-12). */
export async function GET(req: Request, props: Props) {
  const { id } = await props.params;
  return trackApiRoute(req, 'track:read', (ctx) => apiGetIssue(ctx, id));
}

export async function PATCH(req: Request, props: Props) {
  const { id } = await props.params;
  return trackApiRoute(req, 'track:write', async (ctx) => apiUpdateIssue(ctx, id, parseOrThrow(apiIssueUpdateSchema, await jsonBody(req))));
}

/** Borra el issue y sus sub-issues. */
export async function DELETE(req: Request, props: Props) {
  const { id } = await props.params;
  return trackApiRoute(req, 'track:write', (ctx) => apiDeleteIssue(ctx, id));
}
