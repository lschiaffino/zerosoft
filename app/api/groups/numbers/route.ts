import { NextResponse } from 'next/server';
import { availableProviders, createNumber, listNumbers } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';
import { withManage } from '@/lib/groups-number-perms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Líneas que quien pide puede ver (sin credenciales), cuáles administra y los
 * proveedores disponibles. `canEdit`: puede agregar líneas.
 */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const numbers = withManage(s.manager, await listNumbers(s.ws, await sessionViewer(s)));
  return NextResponse.json({ numbers, providers: availableProviders(), canEdit: s.manager.canAdd, isAdmin: s.isAdmin });
}

/**
 * Agrega una línea: admins, o members con permiso para conectar números. La
 * que agrega un member queda a su nombre y privada (ver lib/groups-number-perms.ts).
 * Las credenciales se guardan cifradas.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (!s.manager.canAdd) return groupsError(403, 'forbidden');
  const body = await readJson(req);
  try {
    const config = body.config && typeof body.config === 'object' ? (body.config as Record<string, unknown>) : {};
    const own = s.isAdmin ? {} : { ownerId: s.me, visibility: 'restricted' as const };
    const number = await createNumber(s.ws, s.me, { name: str(body.name, 80), provider: str(body.provider, 20) ?? '', config, ...own });
    return NextResponse.json({ ...number, canManage: true }, { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
