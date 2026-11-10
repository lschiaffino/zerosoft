import { NextResponse } from 'next/server';
import { HubspotError } from '@/lib/groups-hubspot';
import { chatCompany, updateHubspotCompanyProperty } from '@/lib/groups-hubspot-sync';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Edita quien no es invitado ni tiene los teléfonos ocultos, si el token puede escribir empresas. */
const canEdit = (role: string, mask: boolean, canWrite: boolean) => canWrite && role !== 'guest' && !mask;

/**
 * ?chat=<id>: la empresa de HubSpot vinculada a ese chat o grupo con todas
 * sus propiedades, cuándo se sincronizó por última vez y el registro de
 * cambios (qué cambió, de qué valor a cuál, en qué dirección y quién). Si la
 * copia local tiene más de un minuto, se refresca de HubSpot antes de
 * responder.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const chatId = new URL(req.url).searchParams.get('chat') ?? '';
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  try {
    const dto = await chatCompany(s.ws, chatId, { refresh: 'stale', mask: guard.viewer.mask });
    return NextResponse.json({ ...dto, canEdit: canEdit(s.user.role, guard.viewer.mask, dto.canWrite) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** { chatId }: "Sincronizar ahora". Trae de HubSpot todas las propiedades de la empresa de ese chat. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const chatId = str((await readJson(req)).chatId, 100) ?? '';
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  try {
    const dto = await chatCompany(s.ws, chatId, { refresh: 'force', mask: guard.viewer.mask });
    if (dto.refreshError) return groupsError(dto.refreshError === 'hubspot_rate_limited' ? 429 : 502, dto.refreshError);
    return NextResponse.json({ ...dto, canEdit: canEdit(s.user.role, guard.viewer.mask, dto.canWrite) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * { chatId, property, value }: cambia una propiedad de la empresa de HubSpot
 * vinculada a ese chat. Se escribe en HubSpot en el momento; si HubSpot no
 * acepta el valor, no se guarda y `detail` dice por qué. Las propiedades de
 * solo lectura o calculadas no se editan. Para selección múltiple, `value` es
 * una lista.
 */
export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const b = await readJson(req);
  const chatId = str(b.chatId, 100) ?? '';
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  // Con los teléfonos ocultos no se ven los de la empresa: tampoco se pisan a ciegas.
  if (guard.viewer.mask) return groupsError(403, 'forbidden');
  try {
    return NextResponse.json(await updateHubspotCompanyProperty(s.ws, s.me, chatId, str(b.property, 120) ?? '', b.value));
  } catch (err) {
    if (err instanceof HubspotError && err.detail) return NextResponse.json({ error: err.code, detail: err.detail }, { status: err.status });
    return handleGroupsError(err);
  }
}
