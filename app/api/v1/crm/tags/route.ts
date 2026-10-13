import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { apiScope } from '@/lib/crm-visibility';
import { createTag, listTags } from '@/lib/crm-tags';
import { tagCreateSchema } from '@/lib/crm-schema';
import { cleanRow, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  return NextResponse.json({ tags: (await listTags(auth.user.id, undefined, await apiScope(auth))).map(cleanRow) });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = tagCreateSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  const res = await createTag(auth.user.id, parsed.data);
  if (!res.ok) return apiError(409, 'duplicate_tag', 'A tag with that name already exists.');
  return NextResponse.json(cleanRow(res.tag), { status: 201 });
}
