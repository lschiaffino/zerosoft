import { NextResponse } from 'next/server';
import { getHubspotSchema, refreshHubspotSchema, setHubspotMine, setHubspotPinned } from '@/lib/groups-hubspot-sync';
import { getHubspotObjectSchema, isHubspotObjectType, setHubspotObjectMine, setHubspotObjectPinned, type HubspotObjectType } from '@/lib/hubspot-objects';
import { groupsError, groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 'company' (sin el parámetro), 'contact' o 'deal'; otra cosa es un error. */
function typeOf(raw: unknown): 'company' | HubspotObjectType | null {
  if (raw === undefined || raw === null || raw === '' || raw === 'company') return 'company';
  return isHubspotObjectType(raw) ? raw : null;
}

/**
 * Las propiedades de la cuenta de HubSpot conectada (también las propias):
 * nombre, etiqueta, tipo, opciones, grupo y si se pueden editar, más los
 * grupos, los dueños y las que el workspace fijó. ?type=contact|deal: las del
 * contacto o del negocio (sin `type`, las de la empresa). Sirve para la
 * pantalla de HubSpot de un chat y para filtrar la bandeja por propiedad.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const type = typeOf(new URL(req.url).searchParams.get('type'));
  if (!type) return groupsError(400, 'invalid_input');
  try {
    if (type !== 'company') return NextResponse.json(await getHubspotObjectSchema(s.ws, type, s.me));
    let schema = await getHubspotSchema(s.ws, s.me);
    // Conectado antes de que existiera el esquema (o falló al conectar): se importa la primera vez que alguien lo pide.
    if (schema.connected && !schema.syncedAt) {
      await refreshHubspotSchema(s.ws).catch(() => null);
      schema = await getHubspotSchema(s.ws, s.me);
    }
    return NextResponse.json(schema);
  } catch (err) {
    return handleGroupsError(err);
  }
}

/**
 * { refresh: true } vuelve a importar de HubSpot la definición de las
 * propiedades. { pinned: [nombres] } elige cuáles se muestran arriba y en los
 * detalles del chat para todo el workspace (hasta 12; vacío vuelve a las de
 * siempre). Esos dos, solo admins.
 * { mine: [nombres] | null }: las que ve quien pide en los detalles del chat
 * y en el panel de HubSpot, en Lines y en Inbox (null vuelve a las del
 * workspace). Cualquiera menos un invitado.
 * { type: 'contact' | 'deal' }: lo mismo para las del contacto o del negocio
 * (sin `type`, las de la empresa).
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const b = await readJson(req);
  const type = typeOf(b.type);
  if (!type) return groupsError(400, 'invalid_input');
  const workspaceWide = b.refresh === true || Array.isArray(b.pinned);
  if (workspaceWide && !s.isAdmin) return groupsError(403, 'forbidden');
  if (!workspaceWide && !('mine' in b)) return groupsError(400, 'invalid_input');
  if ('mine' in b && b.mine !== null && !Array.isArray(b.mine)) return groupsError(400, 'invalid_input');
  try {
    if (type !== 'company') {
      if (Array.isArray(b.pinned)) await setHubspotObjectPinned(s.ws, type, b.pinned);
      if ('mine' in b) await setHubspotObjectMine(s.ws, s.me, type, b.mine);
      return NextResponse.json(await getHubspotObjectSchema(s.ws, type, s.me, { refresh: b.refresh === true }));
    }
    if (b.refresh === true) await refreshHubspotSchema(s.ws);
    if (Array.isArray(b.pinned)) await setHubspotPinned(s.ws, b.pinned);
    if ('mine' in b) await setHubspotMine(s.ws, s.me, b.mine);
    return NextResponse.json(await getHubspotSchema(s.ws, s.me));
  } catch (err) {
    return handleGroupsError(err);
  }
}
