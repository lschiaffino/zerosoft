import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteCustomField, updateCustomField } from '@/lib/crm';
import { customFieldUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = customFieldUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  // La entidad de un campo no cambia (sus valores viven en los registros de esa entidad).
  const { entity: _entity, ...patch } = parsed.data;
  // Valor único: regla de todo el workspace (y su error dice si hay duplicados): solo owner/admin.
  if (patch.isUnique !== undefined && !isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const field = await catchRef(updateCustomField(user.id, params.id, patch));
  if (field instanceof CrmRefError) return crmError(400, field.code);
  if (!field) return notFound();
  return NextResponse.json(field);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Borrar configuración compartida del workspace: solo owner/admin.
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await deleteCustomField(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
