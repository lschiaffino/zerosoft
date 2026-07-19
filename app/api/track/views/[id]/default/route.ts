import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getIssueView, setDefaultIssueView } from '@/lib/track-data';
import { notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const view = await getIssueView(params.id);
  if (!view || view.user_id !== user.id) return notFound();

  const updated = await setDefaultIssueView(view.project_id, user.id, params.id);
  if (!updated) return notFound();

  return NextResponse.json(updated);
}
