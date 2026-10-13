import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { sessionScope, visibleIds } from '@/lib/crm-visibility';
import { bulkDeleteContacts, bulkUpdateContacts, LIFECYCLE_STAGES } from '@/lib/crm';
import { crmError, forbidden, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bulkSchema = z.object({
  action: z.enum(['set_lifecycle', 'delete']),
  ids: z.array(z.string().min(1).max(64)).min(1).max(500),
  value: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return crmError(400, 'invalid_input');

  const { action, value } = parsed.data;
  const ids = await visibleIds(user.id, 'crm_contacts', parsed.data.ids, await sessionScope(user));
  if (action === 'set_lifecycle') {
    if (!value || !(LIFECYCLE_STAGES as readonly string[]).includes(value)) {
      return crmError(400, 'invalid_input');
    }
    return NextResponse.json({
      count: await bulkUpdateContacts(user.id, ids, { lifecycleStage: value }),
    });
  }
  // Borrar en masa es solo para admins.
  if (!isWorkspaceAdmin(user)) return forbidden();
  return NextResponse.json({ count: await bulkDeleteContacts(user.id, ids) });
}
