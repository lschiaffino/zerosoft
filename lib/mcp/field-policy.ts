/**
 * Campos que no se aceptan por el MCP dentro de operaciones que sí: una URL a la
 * que el servidor va a llamar, o la credencial de un tercero. Sobreviven a la
 * conexión y sacan datos afuera, así que se cargan desde la web. Sumar uno es
 * sumar una línea.
 */
import type { Operation } from './catalog';

export interface FieldRefusal {
  message: string;
  where: string;
}

/** Nombres de campo que no pasan, en cualquier nivel del cuerpo. */
const REFUSED_FIELDS = new Set([
  'webhookUrl',
  'webhook_url',
  'rotateWebhookSecret',
  'callbackUrl',
  'callback_url',
  'baseUrl',
  'base_url',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'authToken',
  'auth_token',
  'clientSecret',
  'client_secret',
  'secretKey',
  'secret_key',
  'webhookSecret',
  'webhook_secret',
  'stripeSecretKey',
  'stripeWebhookSecret',
  'smtpPassword',
  'smtp_pass',
  'headerValue',
  // Le suman datos de un invitado a una URL: siguen andando después de desconectar.
  'redirectPassDetails',
  'passAnswers',
]);

/** Campos que solo se rechazan en esas rutas: la URL a la que van los datos de otra persona. */
const REFUSED_BY_ROUTE: Array<[RegExp, string[]]> = [
  // Compartir un documento vuelve a servirlo en los links de otros. Subir un archivo pide el navegador.
  [/^\/api\/send\/documents\/\[id\]$/, ['sharing']],
  [/^\/api\/send\/documents$/, ['file']],
  // Sus respuestas viajan a esta URL (pass_answers viene prendido por defecto al crear).
  [/^\/api\/calendar\/routing(\/|$)/, ['fallbackUrl', 'targetUrl']],
  [/^\/api\/(v1\/)?calendar\/event-types(\/|$)/, ['redirectUrl']],
];

/**
 * Armar una automatización es un uso central: el grafo de un flow lleva sus
 * propias URLs. Esas operaciones son de clase destructiva (piden confirm), y la
 * pantalla de permisos y la documentación dicen que siguen corriendo al desconectar.
 */
const AUTOMATIONS = /^\/api\/(flow\/flows|crm\/workflows|robots)(\/|$)/;

function findRefusedField(value: unknown, names: ReadonlySet<string>, depth = 0): string | null {
  if (depth > 40 || !value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findRefusedField(item, names, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (names.has(k) && v !== undefined && v !== null && v !== '' && v !== false) return k;
    const hit = findRefusedField(v, names, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Un paso o una acción que llama a una URL: { type: 'webhook', url } en Docs, { channel: 'webhook' } en Cal. */
function hasWebhookStep(value: unknown, depth = 0): boolean {
  if (depth > 40 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasWebhookStep(v, depth + 1));
  const o = value as Record<string, unknown>;
  if (o.type === 'webhook' || o.channel === 'webhook') return true;
  return Object.values(o).some((v) => hasWebhookStep(v, depth + 1));
}

/** Reglas que dependen del valor. Clave: "METHOD /api/ruta". */
const VALUE_RULES: Record<string, (body: Record<string, unknown>) => FieldRefusal | null> = {
  'POST /api/sign/envelopes/[id]/actions': (b) =>
    b.action === 'sign_link' ? { message: 'A signing link works without a session, so it is opened from zerosoft: Sign, the envelope.', where: 'Sign, the envelope' } : null,
  'POST /api/track/access': (b) =>
    b.action === 'setGuest' ? { message: 'Adding a guest gives lasting access, so it is done in zerosoft: Track, project access. The other access changes work here.', where: 'Track, project access' } : null,
  'PATCH /api/teams/members/[userId]': (b) =>
    b.role === 'admin' || b.role === 'owner' ? { message: 'Giving someone the admin or owner role is done in zerosoft: Settings, Members.', where: 'Settings, Members' } : null,
};

export function refusedByFieldPolicy(op: Pick<Operation, 'method' | 'path'>, body: unknown): FieldRefusal | null {
  const asObject = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const byValue = VALUE_RULES[`${op.method} ${op.path}`]?.(asObject);
  if (byValue) return byValue;
  if (AUTOMATIONS.test(op.path)) return null;
  if (hasWebhookStep(body)) {
    return { message: 'A webhook step calls an address with your data and keeps running after you disconnect, so it is added in zerosoft. Other steps and actions work here.', where: 'the settings of this item in zerosoft' };
  }
  const byRoute = REFUSED_BY_ROUTE.filter(([re]) => re.test(op.path)).flatMap(([, names]) => names);
  const field = findRefusedField(body, REFUSED_FIELDS) ?? (byRoute.length ? findRefusedField(body, new Set(byRoute)) : null);
  if (!field) return null;
  return {
    message: `The field ${field} holds an address the server would call, or the key of another service, so it is set in zerosoft. The rest of this operation works here without it.`,
    where: 'the settings of this item in zerosoft',
  };
}
