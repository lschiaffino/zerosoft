import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { crmError, forbidden, invalidBody, unauthorized } from '@/lib/crm-http';
import { createFormData, resetCreateForm, setCreateForm } from '@/lib/crm-create-form';
import { CREATE_FORM_ENTITIES, isCreateFormEntity, MAX_CREATE_FORM_FIELDS } from '@/lib/crm-create-form-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const putSchema = z.object({
  entity: z.enum(CREATE_FORM_ENTITIES),
  fields: z
    .array(z.object({ key: z.string().min(1).max(120), required: z.boolean().optional() }))
    .max(MAX_CREATE_FORM_FIELDS + 10),
});

/**
 * GET ?entity=contacts|companies|deals → el formulario de alta para quien
 * pregunta: propiedades en orden con su obligatoriedad, sin las
 * personalizadas que no puede editar. Suma las personas del workspace (para
 * owner y campos de persona), quién es y la moneda base.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const entity = req.nextUrl.searchParams.get('entity');
  if (!isCreateFormEntity(entity)) return crmError(400, 'invalid_input');
  return NextResponse.json({ entity, ...(await createFormData(user, entity)) });
}

/** Guarda el formulario de un objeto (owner/admin): configuración compartida del workspace. */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const fields = await setCreateForm(user.id, parsed.data.entity, parsed.data.fields);
  return NextResponse.json({ entity: parsed.data.entity, fields });
}

/** DELETE ?entity= → vuelve al formulario por defecto (owner/admin). */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const entity = req.nextUrl.searchParams.get('entity');
  if (!isCreateFormEntity(entity)) return crmError(400, 'invalid_input');
  await resetCreateForm(user.id, entity);
  return NextResponse.json({ ok: true });
}
