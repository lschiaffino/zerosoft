import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { fakeLinearGraphql, LINEAR_FAKE_TOKENS, linearFakeAllowed } from '@/lib/track-linear-fake';
import { notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Solo tests (TRACK_LINEAR_FAKE=1 con NODE_ENV=test o DEMO_MODE): "editar en
 * Linear" contra el workspace falso de lib/track-linear-fake.ts, que después
 * manda su webhook firmado como Linear. Fuera de eso es un 404.
 */
export async function POST(req: NextRequest) {
  if (!linearFakeAllowed()) return notFound();
  if (!(await getCurrentUser())) return unauthorized();
  const body = (await req.json().catch(() => null)) as { token?: string; query?: string; variables?: Record<string, unknown> } | null;
  if (!body?.token || !(LINEAR_FAKE_TOKENS as readonly string[]).includes(body.token) || typeof body.query !== 'string') return notFound();
  const res = fakeLinearGraphql(body.token, body.query, body.variables ?? {});
  return NextResponse.json(res.body, { status: res.status });
}
