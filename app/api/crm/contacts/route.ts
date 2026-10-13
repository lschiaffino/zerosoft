import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { createContact, listContacts } from '@/lib/crm';
import { contactCreateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, pageParams, sortParam, unauthorized } from '@/lib/crm-http';

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

  return NextResponse.json({ rows, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = contactCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const contact = await catchRef(createContact(user.id, { ...parsed.data, ownerId: parsed.data.ownerId ?? realUserId(user) }));
  if (contact instanceof CrmRefError) return crmError(400, contact.code);
  return NextResponse.json(contact, { status: 201 });
}
