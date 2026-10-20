import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listTrash, purgeTrash, TRASH_ENTITIES, type TrashEntity } from '@/lib/crm-trash';
import { crmError, forbidden, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Papelera del CRM: lo borrado en los últimos 90 días (lib/crm-trash.ts). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const entity = sp.get('entity');
  const rows = await listTrash(user.id, {
    entity: (TRASH_ENTITIES as readonly string[]).includes(entity ?? '') ? (entity as TrashEntity) : undefined,
    q: sp.get('q')?.trim() || undefined,
    ownerScope: await sessionScope(user),
  });
  return NextResponse.json({ rows });
}

const purgeSchema = z.union([
  z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) }),
  z.object({ all: z.literal(true) }),
]);

/** Borrado definitivo (entradas puntuales o vaciar la papelera). Solo admins. */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = purgeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  const count = await purgeTrash(user.id, 'all' in parsed.data ? 'all' : parsed.data.ids);
  return NextResponse.json({ count });
}
