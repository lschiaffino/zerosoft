import { NextRequest, NextResponse } from 'next/server';
import { guardRecordCustomWrite, hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { createContact, listContacts } from '@/lib/crm';
import { contactCreateSchema } from '@/lib/crm-schema';
import { catchContactWrite, crmError, CrmRefError, emailTakenResponse, invalidBody, pageParams, sortParam, unauthorized } from '@/lib/crm-http';
import { ContactEmailTakenError } from '@/lib/crm-contact-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS = ['newest', 'oldest', 'name', 'email', 'score', 'score_asc'] as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const { rows, total } = await listContacts(user.id, {
    ownerScope: await sessionScope(user),
    q: sp.get('q') ?? undefined,
    lifecycle: sp.get('lifecycle') ?? undefined,
    leadStatus: sp.get('leadStatus') ?? undefined,
    source: sp.get('source') ?? undefined,
    companyId: sp.get('companyId') ?? undefined,
    sort: sortParam(sp, SORTS),
    page,
    pageSize,
  });

  const hiddenFields = await hiddenFieldsFor(sessionFieldViewer(user), 'contacts');
  return NextResponse.json({ rows: rows.map((r) => redactRow(r, hiddenFields)), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = contactCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const fp = await guardRecordCustomWrite(sessionFieldViewer(user), 'contact', null, parsed.data.custom);
  if (!fp.ok) return crmError(403, 'field_readonly');
  const contact = await catchContactWrite(createContact(user.id, { ...parsed.data, custom: fp.custom, ownerId: parsed.data.ownerId ?? realUserId(user) }));
  if (contact instanceof CrmRefError) return crmError(400, contact.code);
  // El email es la identidad del contacto: 409 con el existente solo si quien pide lo ve.
  if (contact instanceof ContactEmailTakenError) return emailTakenResponse(contact, await sessionScope(user));
  return NextResponse.json(contact, { status: 201 });
}
