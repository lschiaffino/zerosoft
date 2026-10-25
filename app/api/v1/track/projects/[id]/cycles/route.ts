import { apiCreateCycle, apiCycleCreateSchema, apiListCycles, parseOrThrow } from '@/lib/track-api-ops';
import { jsonBody, trackApiRoute } from '@/lib/track-api-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function GET(req: Request, props: Props) {
  const { id } = await props.params;
  return trackApiRoute(req, 'track:read', (ctx) => apiListCycles(ctx, id));
}

export async function POST(req: Request, props: Props) {
  const { id } = await props.params;
  return trackApiRoute(req, 'track:write', async (ctx) => apiCreateCycle(ctx, id, parseOrThrow(apiCycleCreateSchema, await jsonBody(req))), 201);
}
