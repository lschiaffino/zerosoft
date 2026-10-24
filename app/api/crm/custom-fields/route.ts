import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createCustomField, listCustomFields } from '@/lib/crm';
import { customFieldCreateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';
import { getObject } from '@/lib/crm-objects';
import { fieldAccessFor, sessionFieldViewer } from '@/lib/crm-field-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTITIES = ['contacts', 'companies', 'deals', 'leads'] as const;

/** ¿La entidad existe en el workspace? (las fijas siempre; `obj:<id>` si el objeto es suyo). */
async function entityExists(workspaceId: string, entity: string): Promise<boolean> {
  if ((ENTITIES as readonly string[]).includes(entity)) return true;
  const m = /^obj:([A-Za-z0-9-]{1,64})$/.exec(entity);
  return !!m && !!(await getObject(workspaceId, m[1]));
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const entity = req.nextUrl.searchParams.get('entity');
  if (entity && !(await entityExists(user.id, entity))) {
    return crmError(400, 'invalid_input');
  }
  // Con entidad: sin los campos que la persona tiene ocultos (permisos por campo).
  if (entity) {
    const { visible } = await fieldAccessFor(sessionFieldViewer(user), entity);
    return NextResponse.json({ rows: visible });
  }
  return NextResponse.json({ rows: await listCustomFields(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = customFieldCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  if (!(await entityExists(user.id, parsed.data.entity))) return crmError(400, 'invalid_input');
  const field = await createCustomField(user.id, parsed.data);
  return NextResponse.json(field, { status: 201 });
}
