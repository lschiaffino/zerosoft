import { corsPreflight, publicJson } from '@/lib/oauth/metadata';
import { DEVICE_GRANT, exchangeCode, getClient, pollDevice, refreshTokens, TokenError } from '@/lib/oauth/store';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readParams(req: Request): Promise<URLSearchParams | null> {
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return null;
  return new URLSearchParams(await req.text());
}

const STATUS: Record<string, number> = { invalid_client: 401 };

/** Endpoint de tokens: authorization_code + PKCE, refresh con rotación y device_code. */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'oauth-token', 120, 60);
  if (limited) return publicJson({ error: 'rate_limited' }, 429);
  const p = await readParams(req);
  if (!p) return publicJson({ error: 'invalid_request', error_description: 'Use application/x-www-form-urlencoded.' }, 400);
  const clientId = p.get('client_id') ?? '';
  try {
    const client = await getClient(clientId);
    if (!client) throw new TokenError('invalid_client', 'Unknown client.');
    const grant = p.get('grant_type');
    if (grant === 'authorization_code') {
      return publicJson(await exchangeCode({ code: p.get('code') ?? '', clientId, redirectUri: p.get('redirect_uri') ?? '', verifier: p.get('code_verifier') ?? '', resource: p.get('resource') }));
    }
    if (grant === 'refresh_token') {
      return publicJson(await refreshTokens({ refreshToken: p.get('refresh_token') ?? '', clientId, resource: p.get('resource'), scope: p.get('scope') }));
    }
    if (grant === DEVICE_GRANT) {
      if (!client.grant_types.includes(DEVICE_GRANT)) throw new TokenError('invalid_grant', 'This client did not register the device grant.');
      return publicJson(await pollDevice({ deviceCode: p.get('device_code') ?? '', clientId }));
    }
    throw new TokenError('unsupported_grant_type', 'Unsupported grant type.');
  } catch (err) {
    if (err instanceof TokenError) return publicJson({ error: err.code, error_description: err.message }, STATUS[err.code] ?? 400);
    throw err;
  }
}

export async function OPTIONS() {
  return corsPreflight();
}
