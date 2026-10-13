import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getDocPage, resolveDocAccess } from '@/lib/docs';
import { restoreDocVersion } from '@/lib/docs-versions';
import { forbidden, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const res = await resolveDocAccess(user, id);
  if (!res) return notFound();
  if (res.access === 'view') return forbidden();
  if (!(await restoreDocVersion(res.row.user_id, id, versionId, realUserId(user)))) return notFound();
  return NextResponse.json(await getDocPage(res.row.user_id, id));
}
