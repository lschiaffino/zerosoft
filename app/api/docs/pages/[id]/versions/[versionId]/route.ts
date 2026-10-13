import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { resolveDocAccess } from '@/lib/docs';
import { getDocVersion } from '@/lib/docs-versions';
import { notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const res = await resolveDocAccess(user, id);
  if (!res) return notFound();
  const version = await getDocVersion(res.row.user_id, id, versionId);
  if (!version) return notFound();
  return NextResponse.json(version);
}
