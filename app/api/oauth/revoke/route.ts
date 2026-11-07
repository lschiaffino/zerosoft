import { corsPreflight, publicJson } from '@/lib/oauth/metadata';
import { revokeToken } from '@/lib/oauth/store';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revocación (RFC 7009). Responde 200 también con un token desconocido. */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'oauth-revoke', 60, 60);
  if (limited) return publicJson({ error: 'rate_limited' }, 429);
  const p = new URLSearchParams(await req.text());
  const token = p.get('token');
  if (!token) return publicJson({ error: 'invalid_request' }, 400);
  await revokeToken(token, p.get('client_id'));
  return publicJson({});
}

export async function OPTIONS() {
  return corsPreflight();
}
