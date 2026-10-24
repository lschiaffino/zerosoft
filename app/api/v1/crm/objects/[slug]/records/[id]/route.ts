import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser, type ApiKeyAuth } from '@/lib/api-auth';
import { apiScope, canSeeOwner } from '@/lib/crm-visibility';
import { deleteRecord, getObjectBySlug, getRecord, objectEntity, recordLinks, updateRecord } from '@/lib/crm-objects';
import { objectRecordUpdateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, zodErrorCode } from '@/lib/crm-http';
import { apiFieldViewer, guardCustomWrite, hiddenFieldsFor, redactRow } from '@/lib/crm-field-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => apiError(404, 'not_found', 'Record not found.');

async function visible(auth: ApiKeyAuth, slug: string, id: string) {
  const object = await getObjectBySlug(auth.user.id, slug);
  if (!object) return null;
  const record = await getRecord(auth.user.id, id);
  if (!record || record.object_id !== object.id || !canSeeOwner(await apiScope(auth), record.owner_id, auth.user.id)) return null;
  return { object, record };
}

/** El registro con sus asociaciones (ids de contactos, empresas y deals). */
export async function GET(req: NextRequest, props: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await props.params;
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const found = await visible(auth, slug, id);
  if (!found) return notFound();
  const [hidden, links] = await Promise.all([
    hiddenFieldsFor(apiFieldViewer(auth), objectEntity(found.object.id)),
    recordLinks(auth.user.id, id),
  ]);
  return NextResponse.json({
    ...cleanRow(redactRow(found.record, hidden)),
    associations: {
      contacts: links.contacts.map((c) => c.id),
      companies: links.companies.map((c) => c.id),
      deals: links.deals.map((d) => d.id),
    },
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const found = await visible(auth, slug, id);
  if (!found) return notFound();
  const parsed = objectRecordUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  const viewer = apiFieldViewer(auth);
  const entity = objectEntity(found.object.id);
  const guard = await guardCustomWrite(viewer, entity, found.record.custom, parsed.data.custom);
  if (!guard.ok) return apiError(403, 'field_readonly', 'A property in the body is read-only for this key.');
  const updated = await catchRef(updateRecord(auth.user.id, id, { ...parsed.data, custom: guard.custom }));
  if (updated instanceof CrmRefError) return apiError(400, updated.code, 'A referenced record does not exist.');
  if (!updated) return notFound();
  return NextResponse.json(cleanRow(redactRow(updated, await hiddenFieldsFor(viewer, entity))));
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  if (!(await visible(auth, slug, id))) return notFound();
  await deleteRecord(auth.user.id, id);
  return new NextResponse(null, { status: 204 });
}
