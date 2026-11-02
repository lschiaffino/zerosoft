import { corsPreflight, publicJson } from '@/lib/oauth/metadata';
import { registerClient, RegistrationError } from '@/lib/oauth/store';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Registro dinámico de clientes (RFC 7591). Solo clientes públicos: no se emite ningún secreto. */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'oauth-register', 60, 3600);
  if (limited) return publicJson({ error: 'rate_limited' }, 429);
  const meta = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return publicJson({ error: 'invalid_client_metadata', error_description: 'Send a JSON object.' }, 400);
  try {
    const client = await registerClient(meta);
    return publicJson(
      {
        client_id: client.client_id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: client.name,
        ...(client.client_uri ? { client_uri: client.client_uri } : {}),
        redirect_uris: client.redirect_uris,
        grant_types: client.grant_types,
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      201,
    );
  } catch (err) {
    if (err instanceof RegistrationError) return publicJson({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}

export async function OPTIONS() {
  return corsPreflight();
}
