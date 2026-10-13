import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createLabel, listLabels, trackWorkspaceId } from '@/lib/track-labels';
import { labelCreateSchema } from '@/lib/track-schema';
import { invalidBody, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Labels del workspace activo (con ?counts=1, cuántos issues usan cada uno). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const ws = trackWorkspaceId(user.team?.id ?? null, user.id);
  const rows = await listLabels(ws, req.nextUrl.searchParams.get('counts') === '1');
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = labelCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await createLabel(trackWorkspaceId(user.team?.id ?? null, user.id), parsed.data);
  if (!res.ok) return trackError(409, 'duplicate_label');
  return NextResponse.json(res.label, { status: 201 });
}
