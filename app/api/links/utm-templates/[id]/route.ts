import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { deleteUtmTemplate } from '@/lib/link-utm-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await deleteUtmTemplate(user.id, id, realUserId(user), isWorkspaceAdmin(user));
  if (result === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (result === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return new NextResponse(null, { status: 204 });
}
