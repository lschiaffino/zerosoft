import { corsPreflight, publicJson } from '@/lib/oauth/metadata';
import { canonicalResource, createDeviceCode, DEVICE_GRANT, DEVICE_INTERVAL_SEC, getClient, issuerUrl, mcpResourceUrl, parseScope, serializeScope } from '@/lib/oauth/store';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Autorización de dispositivo (RFC 8628): la CLI en una máquina sin navegador. */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'oauth-device', 20, 600);
  if (limited) return publicJson({ error: 'rate_limited' }, 429);
  const p = new URLSearchParams(await req.text());
  const client = await getClient(p.get('client_id') ?? '');
  if (!client) return publicJson({ error: 'invalid_client' }, 401);
  if (!client.grant_types.includes(DEVICE_GRANT)) return publicJson({ error: 'unauthorized_client' }, 400);
  const scopes = parseScope(p.get('scope'));
  if (!scopes) return publicJson({ error: 'invalid_scope' }, 400);
  const expected = canonicalResource(mcpResourceUrl()) as string;
  const resource = p.get('resource');
  if (resource && canonicalResource(resource) !== expected) return publicJson({ error: 'invalid_target' }, 400);
  const { deviceCode, userCode, expiresIn } = await createDeviceCode({ clientId: client.client_id, scope: serializeScope(scopes), resource: expected });
  const uri = `${issuerUrl()}/oauth/device`;
  return publicJson({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: uri,
    verification_uri_complete: `${uri}?code=${encodeURIComponent(userCode)}`,
    expires_in: expiresIn,
    interval: DEVICE_INTERVAL_SEC,
  });
}

export async function OPTIONS() {
  return corsPreflight();
}
