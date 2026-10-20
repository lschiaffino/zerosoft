import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { roleAtLeast } from '@/lib/teams';
import { applyLinkPatch, deleteLink, getUserLink, getUserLinkByRef, linkPatchSchema, toLinkDto } from '@/lib/links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'links:read');
  if ('res' in auth) return auth.res;
  // {id} acepta ext_<externalId>.
  const link = await getUserLinkByRef(auth.user.id, params.id);
  if (!link) return apiError(404, 'not_found', 'Link not found.');
  return NextResponse.json(toLinkDto(link));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'links:write');
  if ('res' in auth) return auth.res;
  const link = await getUserLinkByRef(auth.user.id, params.id);
  if (!link) return apiError(404, 'not_found', 'Link not found.');

  const body: unknown = await req.json().catch(() => null);
  const parsed = linkPatchSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'invalid_input', 'The request body is not valid.');
  const failed = await applyLinkPatch(link, parsed.data);
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
  const link = await getUserLinkByRef(auth.user.id, params.id);
  if (!link) return apiError(404, 'not_found', 'Link not found.');
  await deleteLink(link);
  return new NextResponse(null, { status: 204 });
}
