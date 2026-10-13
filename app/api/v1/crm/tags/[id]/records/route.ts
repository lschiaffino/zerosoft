import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { applyTag } from '@/lib/crm-tags';
import { tagApplySchema } from '@/lib/crm-schema';
import { catchRef, CrmRefError, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Agrega o quita el tag a varios registros (ids ajenos se ignoran). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = tagApplySchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  const { entity, ids, action } = parsed.data;
  const changed = await catchRef(applyTag(auth.user.id, id, entity, ids, action));
  if (changed instanceof CrmRefError) return apiError(404, 'not_found', 'Tag not found.');
  return NextResponse.json({ changed });
}
