import { NextResponse } from 'next/server';
import { setSubscription } from '@/lib/board';
import { verifyUnsubscribeToken } from '@/lib/board-notify';
import { getRoadmapItem } from '@/lib/roadmap';
import { absoluteItemUrl } from '@/lib/board-urls';

export const dynamic = 'force-dynamic';

/** Link del email: desuscribe sin sesión (token HMAC) y vuelve al ítem. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const itemId = url.searchParams.get('i') ?? '';
  const userId = url.searchParams.get('u') ?? '';
  const token = url.searchParams.get('t') ?? '';
  if (!itemId || !userId || !verifyUnsubscribeToken(itemId, userId, token)) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }
  const item = await getRoadmapItem(itemId);
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await setSubscription(itemId, userId, false);
  return NextResponse.redirect(`${absoluteItemUrl('en', item.id, item.title)}?unsubscribed=1`, 303);
}
