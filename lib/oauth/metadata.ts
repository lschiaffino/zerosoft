/** Metadatos de descubrimiento (RFC 8414 y RFC 9728) y CORS de los endpoints sin cookies. */
import { NextResponse } from 'next/server';
import { DEVICE_GRANT, issuerUrl, mcpResourceUrl, SCOPES } from './store';

/**
 * Los endpoints del servidor OAuth no usan cookies: se autentican con lo que
 * trae el cuerpo. Por eso admiten cualquier origen (clientes MCP en navegador).
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
};

export function publicJson(body: unknown, status = 200, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store', ...headers } });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function authorizationServerMetadata() {
  const issuer = issuerUrl();
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    device_authorization_endpoint: `${issuer}/api/oauth/device_authorization`,
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token', DEVICE_GRANT],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/docs/mcp`,
  };
}

export function protectedResourceMetadata() {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [issuerUrl()],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'zerosoft',
    resource_documentation: `${issuerUrl()}/docs/mcp`,
  };
}

export function resourceMetadataUrl(): string {
  return `${issuerUrl()}/.well-known/oauth-protected-resource/api/mcp`;
}
