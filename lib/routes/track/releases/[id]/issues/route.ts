import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getAccessibleRelease, setReleaseIssues } from '@/lib/track-releases';
import { releaseIssuesSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Suma (o con `remove` saca) issues del release: solo los del mismo team; el resto vuelve en `skipped`. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getAccessibleRelease((await props.params).id, user.team?.id ?? null, user.id);
  if (!found) return notFound();
  const parsed = releaseIssuesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await setReleaseIssues(found.release, parsed.data.issueIds, !parsed.data.remove, realUserId(user));
  return NextResponse.json(res);
}
