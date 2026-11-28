import { NextRequest, NextResponse } from 'next/server';
import { maskPrivateRef, PRIVATE_REFS } from '@/lib/crm-record-scope';
import { guardRecordCustomWrite, hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope, assertVisibleRefs, canSeeEntity } from '@/lib/crm-visibility';
import { requestFilter } from '@/lib/crm-filter-http';
import { getUserTimeZone } from '@/lib/user-tz';
import { createContact, listContacts } from '@/lib/crm';
import { contactCreateSchema } from '@/lib/crm-schema';
import { catchContactWrite, catchRef, crmError, CrmRefError, emailTakenResponse, invalidBody, pageParams, sortParam, unauthorized } from '@/lib/crm-http';
import { ContactEmailTakenError } from '@/lib/crm-contact-email';
import { createFormMissing } from '@/lib/crm-create-form';
import { isCreateFormRequest } from '@/lib/crm-create-form-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS = ['newest', 'oldest', 'name', 'email', 'score', 'score_asc'] as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const filter = await requestFilter(sp, 'contacts', { viewer: sessionFieldViewer(user), viewerId: realUserId(user), timeZone: await getUserTimeZone() });
  if ('error' in filter) return crmError(400, 'invalid_filter');
  const scope = await sessionScope(user);
  // Los contactos de una empresa que la persona no ve: ninguno (no dice quién trabaja ahí).
  const companyId = sp.get('companyId');
  if (companyId && !(await canSeeEntity(user.id, 'company', companyId, scope))) return NextResponse.json({ rows: [], total: 0, page, pageSize });
  const { rows, total } = await listContacts(user.id, {
    ownerScope: scope,
    ...filter,
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
  const data = { ...parsed.data, custom: fp.custom, ownerId: parsed.data.ownerId ?? realUserId(user) };
  // Las obligatorias del formulario de alta (Ajustes › Datos), solo para las altas desde ese formulario.
  if (isCreateFormRequest(body)) {
    const missing = await createFormMissing(sessionFieldViewer(user), 'contacts', data);
    if (missing.fields.length) return NextResponse.json({ error: 'missing_required', ...missing }, { status: 400 });
  }
  // No se vincula un registro que la persona no ve (mismo error que un id que no existe).
  const refsHidden = await catchRef(assertVisibleRefs(user.id, parsed.data, await sessionScope(user)));
  if (refsHidden instanceof CrmRefError) return crmError(400, refsHidden.code);
  // La empresa que se vincula sola por el dominio del email tiene que ser una que la persona ve.
  const contact = await catchContactWrite(createContact(user.id, data, undefined, { linkScope: await sessionScope(user) }));
  if (contact instanceof CrmRefError) return crmError(400, contact.code);
  // El email es la identidad del contacto: 409 con el existente solo si quien pide lo ve.
  if (contact instanceof ContactEmailTakenError) return emailTakenResponse(contact, await sessionScope(user));
  // La empresa vinculada sola por el dominio del email puede ser una que la persona no ve: sale como privada.
  const shown = (await maskPrivateRef(user.id, contact, [PRIVATE_REFS.company([])], await sessionScope(user)))!;
  return NextResponse.json(redactRow(shown, await hiddenFieldsFor(sessionFieldViewer(user), 'contacts')), { status: 201 });
}
