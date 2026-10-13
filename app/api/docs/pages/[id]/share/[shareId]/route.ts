import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteDocShare, updateDocShareRole } from '@/lib/docs';
import { docShareUpdateSchema } from '@/lib/docs-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string; shareId: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = docShareUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const share = await updateDocShareRole(user.id, params.id, params.shareId, parsed.data.role);
  if (!share) return notFound();
  return NextResponse.json(share);
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; shareId: string }> }
) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteDocShare(user.id, params.id, params.shareId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
