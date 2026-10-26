import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { applyTag } from '@/lib/crm-tags';
import { tagApplySchema } from '@/lib/crm-schema';
import { catchRef, CrmRefError, zodErrorCode } from '@/lib/crm-http';
import { apiScope, visibleIds } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Agrega o quita el tag a varios registros (ids ajenos se ignoran). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = tagApplySchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  const { entity, action } = parsed.data;
  // La key actúa como su creador: los registros que no ve se ignoran (como los ajenos).
  const ids = await visibleIds(auth.user.id, ({ contact: 'crm_contacts', company: 'crm_companies', deal: 'crm_deals' } as const)[entity], parsed.data.ids, await apiScope(auth));
  const changed = await catchRef(applyTag(auth.user.id, id, entity, ids, action));
  if (changed instanceof CrmRefError) return apiError(404, 'not_found', 'Tag not found.');
  return NextResponse.json({ changed });
}
