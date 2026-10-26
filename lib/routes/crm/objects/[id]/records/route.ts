import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { createRecord, getObject, listRecords, objectEntity } from '@/lib/crm-objects';
import { parseFilterRules } from '@/lib/crm';
import { objectRecordCreateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, pageParams, unauthorized } from '@/lib/crm-http';
import { fieldAccessFor, guardCustomWrite, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { filterTypeFor } from '@/lib/crm-custom-fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS = ['newest', 'oldest', 'name', 'name_desc'] as const;

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const object = await getObject(user.id, id);
  if (!object) return notFound();
  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const viewer = sessionFieldViewer(user);
  const access = await fieldAccessFor(viewer, objectEntity(id));
  const sort = sp.get('sort');
  const { rows, total } = await listRecords(user.id, id, {
    ownerScope: await sessionScope(user),
    q: sp.get('q') ?? undefined,
    owner: sp.get('owner') ?? undefined,
    // Sin filtrar por campos que la persona no ve.
    filters: parseFilterRules(sp.get('filters') ?? undefined).filter(
      (r) => !r.f.startsWith('custom:') || !access.hidden.has(r.f.slice(7)),
    ),
    customTypes: Object.fromEntries(access.visible.map((d) => [d.name, filterTypeFor(d.type)])),
    sort: (SORTS as readonly string[]).includes(sort ?? '') ? (sort as (typeof SORTS)[number]) : undefined,
    page,
    pageSize,
  });
  return NextResponse.json({ rows: rows.map((r) => redactRow(r, access.hidden)), total, page, pageSize });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const object = await getObject(user.id, id);
  if (!object) return notFound();
  const parsed = objectRecordCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const guard = await guardCustomWrite(sessionFieldViewer(user), objectEntity(id), '{}', parsed.data.custom);
  if (!guard.ok) return crmError(403, 'field_readonly');
  const record = await catchRef(
    createRecord(user.id, id, { ...parsed.data, custom: guard.custom, ownerId: parsed.data.ownerId ?? realUserId(user) }),
  );
  if (record instanceof CrmRefError) return crmError(400, record.code);
  return NextResponse.json(record, { status: 201 });
}
