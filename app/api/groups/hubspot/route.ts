import { NextResponse } from 'next/server';
import { HUBSPOT_SCOPES, connectHubspot, disconnectHubspot, getHubspot, updateHubspotSettings } from '@/lib/groups-hubspot';
import { groupsBaseUrl } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Estado de la conexión con HubSpot del workspace: si está conectado, la
 * cuenta, los permisos del token y los ajustes. El token nunca vuelve. Quien
 * no es admin solo ve si está conectado.
 */
export async function GET(req?: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const dto = await getHubspot(s.ws);
  if (!s.isAdmin) return NextResponse.json({ connected: dto.connected });
  return NextResponse.json({ ...dto, requiredScopes: HUBSPOT_SCOPES, webhookUrl: webhookUrl(req) });
}

/** La URL que se pega en los webhooks de la private app. */
const webhookUrl = (req?: Request) => `${groupsBaseUrl(req ? new URL(req.url).origin : null)}/api/groups/hubspot/webhook`;

/**
 * { token?, autoLink?, logNotes?, webhookSecret? }: conecta con el token de
 * una private app de HubSpot (se valida y se leen sus permisos) o cambia los
 * ajustes. webhookSecret es el client secret de la app, para validar sus
 * webhooks (vacío lo borra). Solo admins.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    let dto = await getHubspot(s.ws);
    if (typeof b.token === 'string' && b.token.trim()) dto = await connectHubspot(s.ws, s.me, b.token);
    else if (!dto.connected) return groupsError(400, 'hubspot_invalid_token');
    if (typeof b.autoLink === 'boolean' || typeof b.logNotes === 'boolean' || typeof b.webhookSecret === 'string') {
      dto = await updateHubspotSettings(s.ws, {
        autoLink: typeof b.autoLink === 'boolean' ? b.autoLink : undefined,
        logNotes: typeof b.logNotes === 'boolean' ? b.logNotes : undefined,
        webhookSecret: typeof b.webhookSecret === 'string' ? b.webhookSecret : undefined,
      });
    }
    return NextResponse.json({ ...dto, requiredScopes: HUBSPOT_SCOPES, webhookUrl: webhookUrl(req) });
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** Desconecta HubSpot: borra el token guardado. Solo admins. */
export async function DELETE() {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  return (await disconnectHubspot(s.ws)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
