import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getContact, updateContact } from '@/lib/crm';
import { contactUpdateSchema } from '@/lib/crm-schema';
import { cleanRow, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const detail = await getContact(auth.user.id, params.id);
  if (!detail) return apiError(404, 'not_found', 'Contact not found.');
  return NextResponse.json(cleanRow(detail.contact));
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = contactUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const contact = await updateContact(auth.user.id, params.id, parsed.data);
  if (!contact) return apiError(404, 'not_found', 'Contact not found.');
  return NextResponse.json(cleanRow(contact));
}
