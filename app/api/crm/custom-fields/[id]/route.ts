import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteCustomField, updateCustomField } from '@/lib/crm';
import { customFieldUpdateSchema } from '@/lib/crm-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = customFieldUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const field = updateCustomField(user.id, params.id, parsed.data);
  if (!field) return notFound();
  return NextResponse.json(field);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!deleteCustomField(user.id, params.id)) return notFound();
  return new NextResponse(null, { status: 204 });
}
