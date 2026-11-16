import { NextResponse } from 'next/server';
import { getHubspotSchema, refreshHubspotSchema, setHubspotMine, setHubspotPinned } from '@/lib/groups-hubspot-sync';
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
  let schema = await getHubspotSchema(s.ws, s.me);
  // Conectado antes de que existiera el esquema (o falló al conectar): se importa la primera vez que alguien lo pide.
  if (schema.connected && !schema.syncedAt) {
    await refreshHubspotSchema(s.ws).catch(() => null);
    schema = await getHubspotSchema(s.ws, s.me);
  }
  return NextResponse.json(schema);
}

/**
 * { refresh: true } vuelve a importar de HubSpot la definición de las
 * propiedades de empresa. { pinned: [nombres] } elige cuáles se muestran
 * arriba y en los detalles del chat para todo el workspace (hasta 12; vacío
 * vuelve a las de siempre). Esos dos, solo admins.
 * { mine: [nombres] | null }: las que ve quien pide en los detalles del chat
 * y en el panel de HubSpot, en Lines y en Inbox (null vuelve a las del
 * workspace). Cualquiera menos un invitado.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (s.user.role === 'guest') return groupsError(403, 'forbidden');
  const b = await readJson(req);
  const workspaceWide = b.refresh === true || Array.isArray(b.pinned);
  if (workspaceWide && !s.isAdmin) return groupsError(403, 'forbidden');
  if (!workspaceWide && !('mine' in b)) return groupsError(400, 'invalid_input');
  try {
    if (b.refresh === true) await refreshHubspotSchema(s.ws);
    if (Array.isArray(b.pinned)) await setHubspotPinned(s.ws, b.pinned);
    if ('mine' in b) {
      if (b.mine !== null && !Array.isArray(b.mine)) return groupsError(400, 'invalid_input');
      await setHubspotMine(s.ws, s.me, b.mine);
    }
    return NextResponse.json(await getHubspotSchema(s.ws, s.me));
  } catch (err) {
    return handleGroupsError(err);
  }
}
