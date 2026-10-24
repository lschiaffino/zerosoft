import { NextRequest, NextResponse } from 'next/server';
import { fieldAccessFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { sessionScope, visibleIds } from '@/lib/crm-visibility';
import { bulkDeleteContacts, bulkUpdateContacts, LIFECYCLE_STAGES } from '@/lib/crm';
import { crmError, forbidden, unauthorized } from '@/lib/crm-http';
import { bulkSetProperty } from '@/lib/crm-bulk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bulkSchema = z.object({
  action: z.enum(['set_lifecycle', 'set_property', 'delete']),
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

  const { action, value } = parsed.data;
  const ids = await visibleIds(user.id, 'crm_contacts', parsed.data.ids, await sessionScope(user));
  if (action === 'set_property') {
    const field = parsed.data.field;
    if (!field || value === undefined) return crmError(400, 'invalid_input');
    // Permisos por campo: un campo de solo lectura u oculto no se edita en masa.
    if (field.startsWith('custom:')) {
      const { restricted } = await fieldAccessFor(sessionFieldViewer(user), 'contacts');
      if (restricted.has(field.slice(7))) return crmError(403, 'field_readonly');
    }
    const res = await bulkSetProperty(user.id, 'contact', ids, field, value, user.actingUser?.email ?? user.email);
    if (!res.ok) return crmError(400, res.code);
    return NextResponse.json({ count: res.count, failed: res.failed });
  }
  if (action === 'set_lifecycle') {
    if (typeof value !== 'string' || !(LIFECYCLE_STAGES as readonly string[]).includes(value)) {
      return crmError(400, 'invalid_input');
    }
    return NextResponse.json({
      count: await bulkUpdateContacts(user.id, ids, { lifecycleStage: value }),
    });
  }
  // Borrar en masa es solo para admins.
  if (!isWorkspaceAdmin(user)) return forbidden();
  return NextResponse.json({ count: await bulkDeleteContacts(user.id, ids, user.actingUser?.email ?? user.email) });
}
