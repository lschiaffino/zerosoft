import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { applyLinkPatch, deleteLink, getLinkForViewer, getUserLink, linkPatchSchema, toLinkDto } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { todayClicksForLink } from '@/lib/track';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getLinkForViewer(user.id, params.id, viewerOf(user), 'view');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;
  return NextResponse.json({ ...toLinkDto(link), todayClicks: await todayClicksForLink(link.id) });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const found = await getLinkForViewer(user.id, params.id, viewerOf(user), 'edit');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;

  const body: unknown = await req.json().catch(() => null);
  const parsed = linkPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const failed = await applyLinkPatch(link, parsed.data, viewerOf(user));
  if (failed) return NextResponse.json({ error: failed.error }, { status: failed.status });

  const updated = (await getUserLink(user.id, params.id))!;
  return NextResponse.json(toLinkDto(updated));
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Borrar se lleva todo el historial de clicks: solo admins, igual que el borrado masivo.
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const found = await getLinkForViewer(user.id, params.id, viewerOf(user), 'edit');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;
  await deleteLink(link);
  return new NextResponse(null, { status: 204 });
}
