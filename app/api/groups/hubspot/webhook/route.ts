import { NextResponse } from 'next/server';
import { groupsBaseUrl } from '@/lib/groups';
import { handleHubspotWebhook } from '@/lib/groups-hubspot-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de la private app de HubSpot (opcional): cambios, borrados y
 * fusiones de empresas. Se valida la firma v3 con el client secret de la app
 * que guardó el workspace; sin firma válida es un 401. Los valores no se
 * toman del aviso: se vuelven a leer de HubSpot.
 */
export async function POST(req: Request) {
  const body = (await req.text()).slice(0, 1_000_000);
  const u = new URL(req.url);
  const res = await handleHubspotWebhook({
    method: 'POST',
    // La URL que firmó HubSpot es la pública; detrás de un proxy, req.url puede traer otro host.
    urls: [...new Set([req.url, `${groupsBaseUrl(u.origin)}${u.pathname}${u.search}`])],
    body,
    signature: req.headers.get('x-hubspot-signature-v3') ?? '',
    timestamp: req.headers.get('x-hubspot-request-timestamp') ?? '',
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true });
}
