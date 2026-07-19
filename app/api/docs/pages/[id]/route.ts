import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteDocPage, getDocPage, listDocShares, updateDocPage } from '@/lib/docs';
import { docPageUpdateSchema } from '@/lib/docs-schema';
import { notFound, unauthorized, invalidBody } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const page = await getDocPage(user.id, params.id);
  if (!page) return notFound();
  const shares = await listDocShares(params.id);
  return NextResponse.json({ ...page, shares });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docPageUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const page = await updateDocPage(user.id, params.id, parsed.data);
  if (!page) return notFound();
  return NextResponse.json(page);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteDocPage(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
