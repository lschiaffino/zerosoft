import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { listFieldPermissions, setFieldPermissions } from '@/lib/crm-field-perms';
import { fieldPermissionsSchema } from '@/lib/crm-schema';
import { forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reemplaza las reglas de un campo: [{ subject: 'role:member' | 'team:<id>', access: 'read' | 'hidden' }]. */
export async function PUT(req: NextRequest, props: { params: Promise<{ fieldId: string }> }) {
  const { fieldId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = fieldPermissionsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  if (!(await setFieldPermissions(user.id, fieldId, parsed.data.rules))) return notFound();
  const rows = (await listFieldPermissions(user.id)).filter((r) => r.field_id === fieldId);
  return NextResponse.json({ rows });
}
