import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { sessionScope, visibleIds } from '@/lib/crm-visibility';
import { bulkDeleteDeals } from '@/lib/crm';
import { crmError, forbidden, unauthorized } from '@/lib/crm-http';
import { bulkSetProperty } from '@/lib/crm-bulk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bulkSchema = z.object({
  action: z.enum(['set_property', 'delete']),
  ids: z.array(z.string().min(1).max(64)).min(1).max(500),
  /** set_property: clave de lib/crm-bulk-fields.ts (o custom:<name>). */
  field: z.string().min(1).max(80).optional(),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return crmError(400, 'invalid_input');

  const { action, field, value } = parsed.data;
  const ids = await visibleIds(user.id, 'crm_deals', parsed.data.ids, await sessionScope(user));
  const actor = user.actingUser?.email ?? user.email;
  if (action === 'set_property') {
    if (!field || value === undefined) return crmError(400, 'invalid_input');
    const res = await bulkSetProperty(user.id, 'deal', ids, field, value, actor, user.actingUser?.id ?? user.id);
    if (!res.ok) return crmError(400, res.code);
    return NextResponse.json({ count: res.count, failed: res.failed, blocked: res.blocked });
  }
  // Borrar en masa es solo para admins.
  if (!isWorkspaceAdmin(user)) return forbidden();
  return NextResponse.json({ count: await bulkDeleteDeals(user.id, ids, actor) });
}
