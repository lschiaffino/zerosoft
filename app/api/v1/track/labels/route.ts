import { z } from 'zod';
import { apiCreateLabel, apiListLabels, parseOrThrow } from '@/lib/track-api-ops';
import { jsonBody, trackApiRoute } from '@/lib/track-api-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i).optional(),
  /** Proyecto cuyo workspace recibe el label. */
  projectId: z.string().trim().min(1).max(64),
});

export async function GET(req: Request) {
  return trackApiRoute(req, 'track:read', (ctx) => apiListLabels(ctx));
}

export async function POST(req: Request) {
  return trackApiRoute(req, 'track:write', async (ctx) => apiCreateLabel(ctx, parseOrThrow(createSchema, await jsonBody(req))), 201);
}
