import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getAccessibleIssue } from '@/lib/track-data';
import { isIssueFavorite, setIssueFavorite } from '@/lib/track-issue-favorites';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ favorite: z.boolean() });

/** ¿El issue está en los favoritos de la persona? */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleIssue(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  return NextResponse.json({ favorite: await isIssueFavorite(found.issue.id, realUserId(user)) });
}

/** Marcar ({ favorite: true }) o sacar de favoritos. */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleIssue(id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json({ favorite: await setIssueFavorite(found.issue.id, realUserId(user), parsed.data.favorite) });
}
