import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { apiScope } from '@/lib/crm-visibility';
import { createRecord, getObjectBySlug, listRecords, objectEntity } from '@/lib/crm-objects';
import { objectRecordCreateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, pageParams, zodErrorCode } from '@/lib/crm-http';
import { apiFieldViewer, guardCustomWrite, hiddenFieldsFor, redactRow } from '@/lib/crm-field-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noObject = () => apiError(404, 'not_found', 'Object not found.');

export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const object = await getObjectBySlug(auth.user.id, slug);
  if (!object) return noObject();
  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const { rows, total } = await listRecords(auth.user.id, object.id, {
    ownerScope: await apiScope(auth),
    q: sp.get('q') ?? undefined,
    page,
    pageSize,
  });
  const hidden = await hiddenFieldsFor(apiFieldViewer(auth), objectEntity(object.id));
  return NextResponse.json({
    records: rows.map(({ owner_name: _owner, ...r }) => cleanRow(redactRow(r, hidden))),
    total,
    page,
    pageSize,
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const object = await getObjectBySlug(auth.user.id, slug);
  if (!object) return noObject();
  const parsed = objectRecordCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  const guard = await guardCustomWrite(apiFieldViewer(auth), objectEntity(object.id), '{}', parsed.data.custom);
  if (!guard.ok) return apiError(403, 'field_readonly', 'A property in the body is read-only for this key.');
  const record = await catchRef(
    createRecord(auth.user.id, object.id, { ...parsed.data, custom: guard.custom, ownerId: parsed.data.ownerId ?? auth.personId }),
  );
  if (record instanceof CrmRefError) return apiError(400, record.code, 'A referenced record does not exist.');
  return NextResponse.json(cleanRow(record), { status: 201 });
}
