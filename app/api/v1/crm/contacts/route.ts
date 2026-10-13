import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createContact, listContacts } from '@/lib/crm';
import { contactCreateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, pageParams, zodErrorCode } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';
import { assignNewLead } from '@/lib/crm-assignment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const { rows, total } = await listContacts(auth.user.id, {
    ownerScope: await apiScope(auth),
    q: sp.get('q') ?? undefined,
    page,
    pageSize,
  });

  return NextResponse.json({ contacts: rows.map(cleanRow), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = contactCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  // Sin owner explícito: la key crea como la persona que la generó; si hay
  // regla round-robin para la fuente "api", la regla decide.
  const contact = await catchRef(createContact(auth.user.id, { ...parsed.data, ownerId: parsed.data.ownerId ?? auth.personId }));
  if (contact instanceof CrmRefError) return apiError(400, contact.code, 'A referenced record does not exist.');
  if (!parsed.data.ownerId) {
    const assigned = await assignNewLead(auth.user.id, contact.id, 'api');
    if (assigned) contact.owner_id = assigned;
  }
  return NextResponse.json(cleanRow(contact), { status: 201 });
}
