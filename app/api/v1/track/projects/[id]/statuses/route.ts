import { apiListStatuses } from '@/lib/track-api-ops';
import { trackApiRoute } from '@/lib/track-api-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return trackApiRoute(req, 'track:read', (ctx) => apiListStatuses(ctx, id));
}
