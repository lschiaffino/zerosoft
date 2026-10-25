import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { createInitiative, listInitiatives } from '@/lib/track-initiatives';
import { initiativeCreateSchema } from '@/lib/track-planning-schema';
import { invalidBody, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  return NextResponse.json({ rows: await listInitiatives(ctx.scope, { q: req.nextUrl.searchParams.get('q') || undefined }) });
}

export async function POST(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const parsed = initiativeCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await createInitiative(ctx.scope, ctx.actorId, parsed.data), { status: 201 });
}
