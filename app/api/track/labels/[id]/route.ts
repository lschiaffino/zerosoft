import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteLabel, trackWorkspaceId, updateLabel } from '@/lib/track-labels';
import { labelUpdateSchema } from '@/lib/track-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Renombra o recolorea el label en todo el workspace: solo owner/admin. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const parsed = labelUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await updateLabel(trackWorkspaceId(user.team?.id ?? null, user.id), id, parsed.data);
  if (!res.ok) return res.reason === 'not_found' ? notFound() : trackError(409, 'duplicate_label');
  return NextResponse.json(res.label);
}

/** Borra el label y lo saca de todos los issues: solo owner/admin. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return trackError(403, 'forbidden');
  const ok = await deleteLabel(trackWorkspaceId(user.team?.id ?? null, user.id), id);
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}
