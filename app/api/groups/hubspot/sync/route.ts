import { NextResponse } from 'next/server';
import { getHubspot, getHubspotSyncStatus } from '@/lib/groups-hubspot';
import { resyncHubspot } from '@/lib/groups-hubspot-sync';
import { groupsSession, handleGroupsError } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Sincronizar ahora" de Ajustes › Integraciones: vuelve a leer los permisos
 * de la clave, trae de HubSpot todas las empresas vinculadas, reintenta las
 * notas que habían fallado y devuelve el estado de la conexión con lo que pasó.
 * Solo admins. Si el cron está sincronizando justo ahora, responde 409.
 */
export async function POST() {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  try {
    const result = await resyncHubspot(s.ws);
    return NextResponse.json({ result, hubspot: { ...(await getHubspot(s.ws)), sync: await getHubspotSyncStatus(s.ws) } });
  } catch (err) {
    return handleGroupsError(err);
  }
}
