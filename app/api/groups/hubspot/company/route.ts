import { NextResponse } from 'next/server';
import { HubspotError } from '@/lib/groups-hubspot';
import { chatCompany, updateHubspotCompanyProperty, type ChatCompanyDto } from '@/lib/groups-hubspot-sync';
import { chatObjectLink, hubspotObjectDto, isHubspotObjectType, updateHubspotObjectProperty } from '@/lib/hubspot-objects';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Edita quien no es invitado ni tiene los teléfonos ocultos, si el token puede escribir ese objeto. */
const canEdit = (role: string, mask: boolean, canWrite: boolean) => canWrite && role !== 'guest' && !mask;

/** 'company' (sin el campo), 'contact' o 'deal'; null si es otra cosa. */
const typeOf = (raw: unknown) => (raw === undefined || raw === null || raw === '' || raw === 'company' ? 'company' : isHubspotObjectType(raw) ? raw : null);

/** El registro del chat: la empresa (con su copia y registro) o el contacto o negocio vinculado (leído de HubSpot). */
async function load(ws: string, chatId: string, type: 'company' | 'contact' | 'deal', refresh: 'stale' | 'force', mask: boolean): Promise<ChatCompanyDto> {
  if (type === 'company') return chatCompany(ws, chatId, { refresh, mask });
  const link = await chatObjectLink(ws, chatId, type);
  return hubspotObjectDto(ws, type, link.id, { refresh: refresh === 'force' ? 'force' : 'cache', mask, name: link.name });
}

/**
 * ?chat=<id>: la empresa de HubSpot vinculada a ese chat o grupo con todas
 * sus propiedades, cuándo se sincronizó por última vez y el registro de
 * cambios (qué cambió, de qué valor a cuál, en qué dirección y quién). Si la
 * copia local tiene más de un minuto, se refresca de HubSpot antes de
 * responder. &type=contact|deal: el contacto o el negocio vinculado, con
 * todas sus propiedades (en `company`, el registro; sin registro de cambios).
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const sp = new URL(req.url).searchParams;
  const chatId = sp.get('chat') ?? '';
  const type = typeOf(sp.get('type'));
  if (!type) return groupsError(400, 'invalid_input');
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  try {
    const dto = await load(s.ws, chatId, type, 'stale', guard.viewer.mask);
    return NextResponse.json({ ...dto, canEdit: canEdit(s.user.role, guard.viewer.mask, dto.canWrite) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** { chatId, type? }: "Sincronizar ahora". Trae de HubSpot todas las propiedades de la empresa (o del contacto o negocio) de ese chat. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const chatId = str(b.chatId, 100) ?? '';
  const type = typeOf(b.type);
  if (!type) return groupsError(400, 'invalid_input');
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  try {
    const dto = await load(s.ws, chatId, type, 'force', guard.viewer.mask);
    if (dto.refreshError) return groupsError(dto.refreshError === 'hubspot_rate_limited' ? 429 : 502, dto.refreshError);
    return NextResponse.json({ ...dto, canEdit: canEdit(s.user.role, guard.viewer.mask, dto.canWrite) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * { chatId, property, value, type? }: cambia una propiedad de la empresa (o,
 * con `type`, del contacto o negocio) de HubSpot vinculada a ese chat. Se
 * escribe en HubSpot en el momento; si HubSpot no acepta el valor, no se
 * guarda y `detail` dice por qué. Las propiedades de solo lectura o
 * calculadas no se editan. Para selección múltiple, `value` es una lista.
 */
export async function PATCH(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const b = await readJson(req);
  const chatId = str(b.chatId, 100) ?? '';
  const type = typeOf(b.type);
  if (!type) return groupsError(400, 'invalid_input');
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  // Con los teléfonos ocultos no se ven los de la empresa ni los del contacto: tampoco se pisan a ciegas.
  if (guard.viewer.mask) return groupsError(403, 'forbidden');
  const property = str(b.property, 120) ?? '';
  try {
    if (type === 'company') return NextResponse.json(await updateHubspotCompanyProperty(s.ws, s.me, chatId, property, b.value));
    const link = await chatObjectLink(s.ws, chatId, type);
    if (!link.id) return groupsError(409, 'hubspot_not_linked');
    return NextResponse.json(await updateHubspotObjectProperty(s.ws, type, link.id, property, b.value));
  } catch (err) {
    if (err instanceof HubspotError && err.detail) return NextResponse.json({ error: err.code, detail: err.detail }, { status: err.status });
    return handleGroupsError(err);
  }
}
