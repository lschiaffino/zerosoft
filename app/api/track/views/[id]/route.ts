import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { deleteIssueView, getIssueView, updateIssueView } from '@/lib/track-data';
import { issueViewUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleView(id: string, userId: string) {
  const view = await getIssueView(id);
  if (!view) return null;
  if (view.user_id !== userId) return null;
  return view;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const view = await accessibleView(params.id, realUserId(user));
  if (!view) return notFound();

  return NextResponse.json(view);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const view = await accessibleView(params.id, realUserId(user));
  if (!view) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = issueViewUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const updated = await updateIssueView(params.id, parsed.data);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const view = await accessibleView(params.id, realUserId(user));
  if (!view) return notFound();

  await deleteIssueView(params.id);
  return NextResponse.json({ ok: true });
}
