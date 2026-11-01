import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { requestLocale } from '@/lib/request-locale';
import {
  authorizationRedirect,
  canonicalResource,
  createAuthRequest,
  getClient,
  issuerUrl,
  mcpResourceUrl,
  parseScope,
  redirectMatches,
  serializeScope,
} from '@/lib/oauth/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(status: number, message: string): NextResponse {
  // Sin client_id o redirect válidos no se redirige a ningún lado (open redirect).
  return new NextResponse(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

/**
 * Endpoint de autorización: valida el pedido y lleva a la pantalla de permisos,
 * que pasa por el login normal. Acá todavía no se aprueba nada.
 */
export async function GET(req: NextRequest) {
  const limited = await limitByIp(req, 'oauth-authorize', 60, 60);
  if (limited) return limited;
  const q = req.nextUrl.searchParams;
  const client = await getClient(q.get('client_id') ?? '');
  if (!client) return page(400, 'Unknown client_id.');
  const redirectUri = q.get('redirect_uri') ?? '';
  if (!client.grant_types.includes('authorization_code') || !redirectMatches(client.redirect_uris, redirectUri)) {
    return page(400, 'The redirect_uri is not registered for this client.');
  }
  const state = q.get('state');
  const fail = (error: string, description: string) =>
    NextResponse.redirect(authorizationRedirect(redirectUri, { error, error_description: description, state }), 302);
  if (q.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only the code response type is supported.');
  const challenge = q.get('code_challenge') ?? '';
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail('invalid_request', 'PKCE with S256 is required.');
  const scopes = parseScope(q.get('scope'));
  if (!scopes) return fail('invalid_scope', 'Supported scopes: read, write.');
  // RFC 8707: el token sale atado a este recurso. Otro recurso no se autoriza.
  const expected = canonicalResource(mcpResourceUrl()) as string;
  if (canonicalResource(q.get('resource') ?? mcpResourceUrl()) !== expected) return fail('invalid_target', 'This server only issues tokens for its MCP endpoint.');
  if ((state?.length ?? 0) > 2000) return fail('invalid_request', 'The state is too long.');
  const id = await createAuthRequest({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: serializeScope(scopes),
    state,
    code_challenge: challenge,
    resource: expected,
  });
  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  return NextResponse.redirect(`${issuerUrl()}/${locale}/oauth/consent?request=${encodeURIComponent(id)}`, 302);
}
