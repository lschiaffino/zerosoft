import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { requestLocale } from '@/lib/request-locale';
import {
  authorizationRedirect,
  canonicalResource,
  createAuthRequest,
  getClient,
  isLoopbackHost,
  issuerUrl,
  mcpResourceUrl,
  parseScope,
  redirectMatches,
  serializeScope,
} from '@/lib/oauth/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Endpoint de autorización: valida el pedido y lleva a la pantalla de permisos,
 * que pasa por el login normal. Acá todavía no se aprueba nada.
 */
export async function GET(req: NextRequest) {
  const limited = await limitByIp(req, 'oauth-authorize', 60, 60);
  if (limited) return limited;
  const q = req.nextUrl.searchParams;
  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  // Un pedido inválido no redirige al cliente: cualquiera registra una URI, y esto todavía no pasó por la persona.
  const invalid = (reason: string) => NextResponse.redirect(`${issuerUrl()}/${locale}/oauth/error?reason=${reason}`, 302);
  const client = await getClient(q.get('client_id') ?? '');
  if (!client) return invalid('client');
  const redirectUri = q.get('redirect_uri') ?? '';
  if (!client.grant_types.includes('authorization_code') || !redirectMatches(client.redirect_uris, redirectUri)) return invalid('redirect');
  const state = q.get('state');
  if (q.get('response_type') !== 'code') return invalid('response_type');
  const challenge = q.get('code_challenge') ?? '';
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return invalid('pkce');
  const scopes = parseScope(q.get('scope'));
  if (!scopes) {
    // Una app local está esperando en loopback y ese redirect no lleva a nadie a ningún lado.
    // Un https lo pudo registrar cualquiera: sin login todavía, no se redirige ahí.
    if (!isLoopbackHost(new URL(redirectUri).hostname)) return invalid('scope');
    return NextResponse.redirect(authorizationRedirect(redirectUri, { error: 'invalid_scope', error_description: 'Supported scopes: read, write.', state }), 302);
  }
  // RFC 8707: el token sale atado a este recurso. Otro recurso no se autoriza.
  const expected = canonicalResource(mcpResourceUrl()) as string;
  if (canonicalResource(q.get('resource') ?? mcpResourceUrl()) !== expected) return invalid('resource');
  if ((state?.length ?? 0) > 2000) return invalid('state');
  const id = await createAuthRequest({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: serializeScope(scopes),
    state,
    code_challenge: challenge,
    resource: expected,
  });
  return NextResponse.redirect(`${issuerUrl()}/${locale}/oauth/consent?request=${encodeURIComponent(id)}`, 302);
}
