import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { roleAtLeast } from '@/lib/teams';
import { applyLinkPatch, deleteLink, getLinkForViewer, getUserLink, getUserLinkByRef, linkPatchSchema, toLinkDto } from '@/lib/links';
import { apiViewerOf } from '@/lib/link-folders';
import type { ApiKeyAuth } from '@/lib/api-auth';

/** El link por id o ext_<externalId>, solo si quien creó la key lo ve (acceso por carpeta). */
async function linkFor(auth: ApiKeyAuth, ref: string, need: 'view' | 'edit') {
  const byRef = await getUserLinkByRef(auth.user.id, ref);
  if (!byRef) return { status: 404 as const };
  return getLinkForViewer(auth.user.id, byRef.id, apiViewerOf(auth), need);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'links:read');
  if ('res' in auth) return auth.res;
  // {id} acepta ext_<externalId>.
  const found = await linkFor(auth, params.id, 'view');
  if ('status' in found) return apiError(404, 'not_found', 'Link not found.');
  return NextResponse.json(toLinkDto(found.link));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'links:write');
  if ('res' in auth) return auth.res;
  const found = await linkFor(auth, params.id, 'edit');
  if ('status' in found) return found.status === 403 ? apiError(403, 'forbidden', 'You can only view this link.') : apiError(404, 'not_found', 'Link not found.');
  const link = found.link;

  const body: unknown = await req.json().catch(() => null);
  const parsed = linkPatchSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'invalid_input', 'The request body is not valid.');
  const failed = await applyLinkPatch(link, parsed.data, apiViewerOf(auth), { actorId: auth.personId, via: 'api' });
  if (failed) return apiError(failed.status, failed.error, 'The link could not be updated.');
  return NextResponse.json(toLinkDto((await getUserLink(auth.user.id, link.id))!));
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'links:write');
  if ('res' in auth) return auth.res;
  // La key actúa con el rol de quien la creó: borrar es solo para admins, como en la app.
  if (!roleAtLeast(auth.role, 'admin')) {
    return apiError(403, 'forbidden', 'Deleting links requires a workspace admin. Archive it instead.');
  }
  const found = await linkFor(auth, params.id, 'edit');
  if ('status' in found) return apiError(404, 'not_found', 'Link not found.');
  const link = found.link;
  await deleteLink(link, { actorId: auth.personId, via: 'api' });
  return new NextResponse(null, { status: 204 });
}
