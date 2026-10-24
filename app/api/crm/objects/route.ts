import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { createObject, listObjects } from '@/lib/crm-objects';
import { objectCreateSchema } from '@/lib/crm-schema';
import { crmError, forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Objetos propios del workspace (sidebar, ajustes y Cmd+K). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listObjects(user.id) });
}

/** Definir un objeto: configuración del workspace, solo owner/admin. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = objectCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await createObject(user.id, parsed.data);
  if (!res.ok) return crmError(400, 'object_limit');
  return NextResponse.json(res.object, { status: 201 });
}
