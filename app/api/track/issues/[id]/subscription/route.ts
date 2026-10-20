import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getAccessibleIssue } from '@/lib/track-data';
import { issueSubscriptionSchema } from '@/lib/track-schema';
import { isSubscribedToIssue, setIssueSubscription } from '@/lib/track-subscriptions';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ¿La persona recibe los avisos de este issue? */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleIssue(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  return NextResponse.json({ subscribed: await isSubscribedToIssue(id, realUserId(user)) });
}

/** Suscribirse ({ subscribed: true }) o darse de baja ({ subscribed: false }). */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleIssue(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = issueSubscriptionSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const userId = realUserId(user);
  await setIssueSubscription(id, userId, parsed.data.subscribed);
  return NextResponse.json({ subscribed: await isSubscribedToIssue(id, userId) });
}
