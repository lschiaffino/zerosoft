import { NextRequest, NextResponse } from 'next/server';
import { fieldAccessFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { bulkDeleteCompanies, bulkUpdateCompanies, LIFECYCLE_STAGES } from '@/lib/crm';
import { crmError, forbidden, unauthorized } from '@/lib/crm-http';
import { bulkSetProperty } from '@/lib/crm-bulk';
import { BULK_TASKS_CAP, bulkCreateTasks, bulkTargetFields, bulkTargetIds, bulkTaskFields } from '@/lib/crm-bulk-target';
import { getUserTimeZone } from '@/lib/user-tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Una acción sobre todos los que coinciden (hasta 1.000) puede tardar.
export const maxDuration = 60;

const bulkSchema = z.object({
  action: z.enum(['set_lifecycle', 'set_property', 'delete', 'create_tasks', 'count']),
  /** Los elegidos en la página, o `matching`: todos los que coinciden con el listado (el server lo vuelve a evaluar). */
  ...bulkTargetFields,
  ...bulkTaskFields,
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
  // Borrar en masa es solo para admins (antes de evaluar nada).
  if (action === 'delete' && !isWorkspaceAdmin(user)) return forbidden();
  const target = await bulkTargetIds(user, 'companies', parsed.data);
  if ('error' in target) return crmError(400, target.error);
  const { ids } = target;
  // "Seleccionar todos los que coinciden": cuántos son, para confirmar antes de actuar.
  if (action === 'count') return NextResponse.json({ count: ids.length, total: target.total ?? ids.length });
  if (action === 'create_tasks') {
    if (!parsed.data.task) return crmError(400, 'invalid_input');
    if (ids.length > BULK_TASKS_CAP) return crmError(400, 'too_many_tasks');
    return NextResponse.json(await bulkCreateTasks(user, 'companies', ids, parsed.data.task, await getUserTimeZone()));
  }
  if (action === 'set_property') {
    const field = parsed.data.field;
    if (!field || value === undefined) return crmError(400, 'invalid_input');
    // Permisos por campo: un campo de solo lectura u oculto no se edita en masa.
    if (field.startsWith('custom:')) {
      const { restricted } = await fieldAccessFor(sessionFieldViewer(user), 'companies');
      if (restricted.has(field.slice(7))) return crmError(403, 'field_readonly');
    }
    const res = await bulkSetProperty(user.id, 'company', ids, field, value, user.actingUser?.email ?? user.email);
    if (!res.ok) return crmError(400, res.code);
    return NextResponse.json({ count: res.count, failed: res.failed });
  }
  if (action === 'set_lifecycle') {
    if (typeof value !== 'string' || !(LIFECYCLE_STAGES as readonly string[]).includes(value)) {
      return crmError(400, 'invalid_input');
    }
    return NextResponse.json({
      count: await bulkUpdateCompanies(user.id, ids, { lifecycleStage: value }),
    });
  }
  // Borrar en masa es solo para admins.
  if (!isWorkspaceAdmin(user)) return forbidden();
  return NextResponse.json({ count: await bulkDeleteCompanies(user.id, ids, user.actingUser?.email ?? user.email) });
}
