import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { runInsight } from '@/lib/track-insights';
import { insightQuerySchema } from '@/lib/track-planning-schema';
import { invalidBody, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Corre un insight: { measure, slice, segment, interval, filters }. */
export async function POST(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const parsed = insightQuerySchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await runInsight(ctx.scope, parsed.data));
}
