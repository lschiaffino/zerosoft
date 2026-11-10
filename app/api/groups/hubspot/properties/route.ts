import { NextResponse } from 'next/server';
import { getHubspotSchema, refreshHubspotSchema, setHubspotPinned } from '@/lib/groups-hubspot-sync';
import { groupsError, groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Las propiedades de empresa de la cuenta de HubSpot conectada (también las
 * propias): nombre, etiqueta, tipo, opciones, grupo y si se pueden editar,
 * más los grupos, los dueños y las que el workspace fijó. Sirve para la
 * pantalla de HubSpot de un chat y para filtrar la bandeja por propiedad.
 */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  return NextResponse.json(await getHubspotSchema(s.ws));
}

/**
 * { refresh: true } vuelve a importar de HubSpot la definición de las
 * propiedades de empresa. { pinned: [nombres] } elige cuáles se muestran
 * arriba y en los detalles del chat (hasta 12; vacío vuelve a las de siempre).
 * Solo admins.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    if (b.refresh === true) await refreshHubspotSchema(s.ws);
    if (Array.isArray(b.pinned)) await setHubspotPinned(s.ws, b.pinned);
    return NextResponse.json(await getHubspotSchema(s.ws));
  } catch (err) {
    return handleGroupsError(err);
  }
}
