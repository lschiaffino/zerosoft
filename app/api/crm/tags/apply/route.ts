import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { applyTag } from '@/lib/crm-tags';
import { tagApplySchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, unauthorized } from '@/lib/crm-http';
import { sessionScope, visibleIds } from '@/lib/crm-visibility';
import { bulkTargetIds } from '@/lib/crm-bulk-target';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = tagApplySchema.extend({
  tagId: z.string().min(1).max(64),
  ids: z.array(z.string().min(1).max(64)).max(1000).optional(),
  /** Todos los que coinciden con el listado: el server lo vuelve a evaluar con quien pide (con tope). */
  matching: z.object({ query: z.string().max(20_000) }).optional(),
});

/** Agrega o quita un tag a varios registros (bulk bar de las listas). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const { tagId, entity, action } = parsed.data;
  // Visibilidad por owner: los registros que el viewer no ve se ignoran.
  let ids: string[];
  if (parsed.data.matching) {
    const target = await bulkTargetIds(user, ({ contact: 'contacts', company: 'companies', deal: 'deals' } as const)[entity], { matching: parsed.data.matching });
    if ('error' in target) return crmError(400, target.error);
    ids = target.ids;
  } else {
    if (!parsed.data.ids?.length) return crmError(400, 'invalid_input');
    ids = await visibleIds(user.id, ({ contact: 'crm_contacts', company: 'crm_companies', deal: 'crm_deals' } as const)[entity], parsed.data.ids, await sessionScope(user));
  }
  const res = await catchRef(applyTag(user.id, tagId, entity, ids, action));
  if (res instanceof CrmRefError) return crmError(400, res.code);
  return NextResponse.json({ count: res });
}
