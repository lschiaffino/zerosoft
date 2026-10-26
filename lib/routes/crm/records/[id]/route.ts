import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canSeeOwner, sessionScope } from '@/lib/crm-visibility';
import { deleteRecord, getRecord, objectEntity, updateRecord } from '@/lib/crm-objects';
import { objectRecordUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { guardCustomWrite, hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import type { SessionUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Registro visible para la persona (404 si no existe o no lo ve). */
async function visibleRecord(user: SessionUser, id: string) {
  const record = await getRecord(user.id, id);
  if (!record || !canSeeOwner(await sessionScope(user), record.owner_id, user.id)) return null;
  return record;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const record = await visibleRecord(user, id);
  if (!record) return notFound();
  const hidden = await hiddenFieldsFor(sessionFieldViewer(user), objectEntity(record.object_id));
  return NextResponse.json(redactRow(record, hidden));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const record = await visibleRecord(user, id);
  if (!record) return notFound();
  const parsed = objectRecordUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const viewer = sessionFieldViewer(user);
  const entity = objectEntity(record.object_id);
  const guard = await guardCustomWrite(viewer, entity, record.custom, parsed.data.custom);
  if (!guard.ok) return crmError(403, 'field_readonly');
  const updated = await catchRef(updateRecord(user.id, id, { ...parsed.data, custom: guard.custom }));
  if (updated instanceof CrmRefError) return crmError(400, updated.code);
  if (!updated) return notFound();
  return NextResponse.json(redactRow(updated, await hiddenFieldsFor(viewer, entity)));
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const record = await visibleRecord(user, id);
  if (!record) return notFound();
  await deleteRecord(user.id, id);
  return new NextResponse(null, { status: 204 });
}
