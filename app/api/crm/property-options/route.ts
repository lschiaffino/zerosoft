import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import {
  addOption,
  listOptionSets,
  OptionError,
  optionUsage,
  reorderOptions,
  updateOption,
} from '@/lib/crm-property-options';
import { propertyOptionsSchema } from '@/lib/crm-schema';
import { crmError, forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Opciones de Lifecycle stage, Lead status y Deal type del workspace (cualquier persona del CRM las lee para elegir). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json(await listOptionSets(user.id));
}

/**
 * Editar las opciones (solo owner y admins), como "Edit property" de HubSpot:
 * agregar, renombrar, archivar o restaurar y ordenar. No se borran:
 * archivar deja la opción en los registros que la tienen.
 * Devuelve las opciones de la propiedad y cuántos registros usa cada una.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = propertyOptionsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const body = parsed.data;
  try {
    if (body.action === 'add') await addOption(user.id, body.property, body.label);
    else if (body.action === 'update') await updateOption(user.id, body.property, body.value, { label: body.label, archived: body.archived });
    else await reorderOptions(user.id, body.property, body.values);
  } catch (e) {
    if (e instanceof OptionError) return crmError(e.code === 'option_not_found' ? 404 : 400, e.code);
    throw e;
  }
  const [sets, usage] = await Promise.all([listOptionSets(user.id), optionUsage(user.id, body.property)]);
  return NextResponse.json({ options: sets[body.property], usage });
}
