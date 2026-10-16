import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { DOC_INTERNAL_READ, resolveDocAccess } from '@/lib/docs';
import { listDocVersions, saveDocVersion } from '@/lib/docs-versions';
import { forbidden, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const res = await resolveDocAccess(user, id, DOC_INTERNAL_READ);
  if (!res) return notFound();
  return NextResponse.json({ rows: await listDocVersions(res.row.user_id, id) });
}

/** "Guardar versión": snapshot manual del estado actual. */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const res = await resolveDocAccess(user, id, DOC_INTERNAL_READ);
  if (!res) return notFound();
  if (res.access === 'view') return forbidden();
  const versionId = await saveDocVersion(res.row.user_id, id, realUserId(user), 'manual');
  if (!versionId) return notFound();
  return NextResponse.json({ id: versionId }, { status: 201 });
}
