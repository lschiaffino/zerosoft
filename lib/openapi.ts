/**
 * Spec OpenAPI 3.1 generada desde lib/api-docs.ts (la misma fuente que la
 * página /docs), así la spec y la documentación no se separan nunca.
 */
import { API_BASE_URL, API_ENDPOINTS, API_SECTIONS, endpointScope, type ApiEndpoint } from './api-docs';
import docsEn from '@/messages/en/pages.json';

const text = (docsEn as unknown as { docs: Record<string, string> }).docs;

function schemaType(type: string): Record<string, unknown> {
  const t = type.toLowerCase();
  if (t.includes('|') && !t.includes('string |')) return { type: 'string', enum: type.split('|').map((v) => v.trim()) };
  if (t.startsWith('integer')) return { type: 'integer' };
  if (t.startsWith('number')) return { type: 'number' };
  if (t.startsWith('boolean')) return { type: 'boolean' };
  if (t === 'object') return { type: 'object' };
  if (t.endsWith('[]')) return { type: 'array', items: { type: t === 'object[]' ? 'object' : 'string' } };
  return { type: 'string' };
}

function operation(e: ApiEndpoint): Record<string, unknown> {
  const pathParams = [...e.path.matchAll(/\{(\w+)\}|:(\w+)/g)].map((m) => m[1] ?? m[2]);
  const params = e.params ?? [];
  const hasBody = e.method === 'POST' || e.method === 'PATCH';
  const op: Record<string, unknown> = {
    operationId: e.id,
    summary: text[e.titleKey] ?? e.id,
    description: text[e.descKey] ?? undefined,
    tags: [text[API_SECTIONS.find((s) => s.id === e.sectionId)?.titleKey ?? ''] ?? e.sectionId],
    parameters: [
      ...pathParams.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      ...(hasBody
        ? []
        : params
            .filter((p) => !pathParams.includes(p.name))
            .map((p) => ({
              name: p.name,
              in: 'query',
              required: !!p.required,
              description: text[p.descriptionKey],
              schema: schemaType(p.type),
            }))),
    ],
    responses: {
      [String(e.responseStatus ?? 200)]: {
        description: e.responseStatus === 204 ? 'No content' : 'OK',
        ...(e.response ? { content: { 'application/json': { example: e.response } } } : {}),
      },
      '400': { description: 'Invalid input: { "error": { "code", "message" } }' },
      '401': { description: 'Missing or invalid API key' },
      '403': { description: 'The API key is missing the required scope (insufficient_scope)' },
      '429': { description: 'Rate limited (100 requests/min per key)' },
    },
  };
  const scope = endpointScope(e);
  if (scope) {
    op['x-required-scope'] = scope;
    op.security = [{ bearerAuth: [scope] }];
  }
  if (hasBody) {
    const bodyParams = params.filter((p) => !pathParams.includes(p.name));
    op.requestBody = {
      required: bodyParams.some((p) => p.required),
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: Object.fromEntries(
              bodyParams.map((p) => [p.name, { ...schemaType(p.type), description: text[p.descriptionKey] }]),
            ),
            required: bodyParams.filter((p) => p.required).map((p) => p.name),
          },
          ...(e.request ? { example: e.request } : {}),
        },
      },
    };
  }
  return op;
}

export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const origin = API_BASE_URL.replace(/\/api\/v1$/, '');
  for (const e of API_ENDPOINTS) {
    if (!e.path.startsWith('/api/v1/')) continue; // webhooks y ejemplos externos no son rutas
    const path = e.path.replace(/:(\w+)/g, '{$1}');
    paths[path] ??= {};
    paths[path][e.method.toLowerCase()] = operation(e);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Zerosoft API',
      version: '1.0.0',
      description: 'REST API for Link, CRM, Cal, Agents, Robots, Chat, Groups and Track. Authenticate with a personal key: `Authorization: Bearer zs_…`. Each key has scopes (crm:read, crm:write, links:read, links:write, cal:read, cal:write, agents:run, robots:run, chat:read, chat:write, groups:read, groups:write, track:read, track:write); write includes read. A key acts as the person who created it, so CRM record visibility rules apply.',
      license: { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'zs_…' } } },
    paths,
  };
}
