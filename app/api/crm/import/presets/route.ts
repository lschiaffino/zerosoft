import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createImportPreset, IMPORT_ENTITIES, listImportPresets, type ImportEntityName } from '@/lib/crm-import';
import { importPresetCreateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Presets de mapeo de columnas guardados por el workspace (?entity=contacts|companies|deals). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const entity = req.nextUrl.searchParams.get('entity');
  if (entity && !IMPORT_ENTITIES.includes(entity as ImportEntityName)) return crmError(400, 'invalid_input');
  return NextResponse.json({ rows: await listImportPresets(user.id, (entity as ImportEntityName) || undefined) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = importPresetCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await createImportPreset(user.id, parsed.data), { status: 201 });
}
