import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { deleteTag, updateTag } from '@/lib/crm-tags';
import { tagUpdateSchema } from '@/lib/crm-schema';
import { cleanRow, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = tagUpdateSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  const res = await updateTag(auth.user.id, id, parsed.data);
  if (!res.ok) {
    return res.error === 'not_found'
      ? apiError(404, 'not_found', 'Tag not found.')
      : apiError(409, 'duplicate_tag', 'A tag with that name already exists.');
  }
  return NextResponse.json(cleanRow(res.tag));
}

export async function DELETE(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;
  if (!(await deleteTag(auth.user.id, id))) return apiError(404, 'not_found', 'Tag not found.');
  return new NextResponse(null, { status: 204 });
}
