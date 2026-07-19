import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteCompany, getCompany, updateCompany } from '@/lib/crm';
import { companyUpdateSchema } from '@/lib/crm-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const detail = await getCompany(user.id, params.id);
  if (!detail) return notFound();
  return NextResponse.json(detail);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = companyUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const company = await updateCompany(user.id, params.id, parsed.data, undefined, user.actingUser?.email ?? user.email);
  if (!company) return notFound();
  return NextResponse.json(company);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteCompany(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
