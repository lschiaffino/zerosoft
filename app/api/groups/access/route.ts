import { NextResponse } from 'next/server';
import { getPlatformSettings, listLabelAccess, setLabelAccess, updatePlatformSettings } from '@/lib/groups-access';
import { groupsError, groupsSession, readJson, str, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Acceso por etiqueta y teléfonos ocultos: ajustes y quién tiene cada etiqueta. Solo admins. */
export async function GET() {
  const s = await groupsSession({ admin: true });
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ settings: await getPlatformSettings(s.ws), access: await listLabelAccess(s.ws) });
}

/** { labelAccess?, maskRoles? } */
export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const patch: Record<string, unknown> = {};
  if (typeof b.labelAccess === 'boolean') patch.labelAccess = b.labelAccess;
  if (Array.isArray(b.maskRoles)) patch.maskRoles = strArr(b.maskRoles, 5);
  return NextResponse.json({ settings: await updatePlatformSettings(s.ws, patch) });
}

/** { labelId, personIds }: quién ve los chats con esa etiqueta. */
export async function PUT(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const labelId = str(b.labelId, 100);
  if (!labelId) return groupsError(400, 'invalid_label');
  return NextResponse.json({ labelId, personIds: await setLabelAccess(s.ws, labelId, strArr(b.personIds, 200)) });
}
