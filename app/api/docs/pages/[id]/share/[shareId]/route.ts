import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteDocShare } from '@/lib/docs';
import { notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; shareId: string } },
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteDocShare(user.id, params.id, params.shareId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
