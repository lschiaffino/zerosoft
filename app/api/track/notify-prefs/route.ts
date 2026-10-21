import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { notifyPrefsSchema } from '@/lib/track-schema';
import { getNotifyPrefs, setNotifyPrefs } from '@/lib/track-notify';
import { invalidBody, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cómo le llegan por email los avisos de Track a la persona logueada. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json(await getNotifyPrefs(realUserId(user)));
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = notifyPrefsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await setNotifyPrefs(realUserId(user), parsed.data));
}
