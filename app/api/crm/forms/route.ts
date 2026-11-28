import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createForm, FormError, formsForViewer, formWritesRestricted, listForms } from '@/lib/crm-forms';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { formCreateSchema } from '@/lib/crm-forms-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  // Sin nombrar propiedades que la persona tiene ocultas.
  return NextResponse.json({ forms: await formsForViewer(sessionFieldViewer(user), await listForms(user.id)) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = formCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  // No se arma un form que guarde en una propiedad que la persona no puede editar.
  if (parsed.data.fields && (await formWritesRestricted(sessionFieldViewer(user), parsed.data.fields))) return crmError(403, 'field_readonly');
  try {
    const form = await createForm(user.id, { ...parsed.data, createdBy: realUserId(user) });
    return NextResponse.json(form, { status: 201 });
  } catch (e) {
    if (e instanceof FormError) return crmError(400, e.code);
    throw e;
  }
}
