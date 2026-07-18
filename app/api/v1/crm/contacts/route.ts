import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createContact, listContacts } from '@/lib/crm';
import { contactCreateSchema } from '@/lib/crm-schema';
import { cleanRow, pageParams, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const { rows, total } = await listContacts(auth.user.id, {
    q: sp.get('q') ?? undefined,
    page,
    pageSize,
  });

  return NextResponse.json({ contacts: rows.map(cleanRow), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = contactCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const contact = await createContact(auth.user.id, parsed.data);
  return NextResponse.json(cleanRow(contact), { status: 201 });
}
