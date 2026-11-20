/**
 * HubSpot: validación de la clave que pega el admin (de qué cuenta es, qué
 * permisos tiene y de qué tipo es) y su guardado cifrado. Server-only.
 *
 * Dos tipos de clave sirven para lo mismo (Authorization: Bearer):
 * - el token de una private app heredada ("legacy private app"). HubSpot ya
 *   no deja crear nuevas, pero las que existen siguen andando;
 * - una service key (Development › Keys › Service keys), su reemplazo.
 *
 * La consulta de info del token (/oauth/v2/private-apps/get/access-token-info)
 * está documentada para las private apps. Para una service key HubSpot no
 * documenta una consulta de permisos: si esa llamada no responde, la cuenta
 * sale de /account-info/v3/details y los permisos se prueban uno por uno (una
 * lectura mínima por permiso; para los de escritura, un batch/update con la
 * lista de registros vacía, que por construcción no puede tocar ninguno).
 * Para un permiso de escritura solo un 403 dice que falta; una respuesta que
 * no es un éxito ni un error de validación deja el permiso como "sin
 * confirmar" (unknownScopes).
 */
import { open, seal } from '../secret-box';
import type { FetchLike, SleepFn } from './retry';
import { HubspotApiError, bindHubspotTokenPortal, createHubspotClient, type HubspotBudgetLike, type HubspotClient } from './client';

export type HubspotTokenKind = 'private_app' | 'service_key' | 'unknown';
export const HUBSPOT_TOKEN_KINDS: readonly HubspotTokenKind[] = ['private_app', 'service_key', 'unknown'];

export interface HubspotTokenInfo {
  portalId: string;
  /** Dominio de la app de HubSpot de esa cuenta (app.hubspot.com, app-eu1.hubspot.com…). */
  uiDomain: string;
  scopes: string[];
  kind: HubspotTokenKind;
  /** De dónde salieron los permisos: de la info del token o de probar cada uno. */
  scopesFrom: 'token_info' | 'probe';
  /** Permisos de escritura probados cuya respuesta no confirmó ni negó el permiso. */
  unknownScopes: string[];
}

/** Forma mínima de una clave: algo, sin espacios y de un largo razonable. */
export function looksLikeHubspotToken(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length >= 4 && raw.length <= 400 && !/\s/.test(raw);
}

export function missingHubspotScopes(have: readonly string[], need: readonly string[]): string[] {
  return need.filter((s) => !have.includes(s));
}

const OBJECTS = ['contacts', 'companies', 'deals'] as const;
const SCHEMA_PROBE: Record<string, string> = { contacts: 'email', companies: 'name', deals: 'dealname' };

/** El pedido que prueba un permiso, o null si ese permiso no se puede probar sin escribir de verdad. */
function probeFor(scope: string): { method: string; path: string; body?: unknown } | null {
  let m = /^crm\.objects\.(contacts|companies|deals)\.(read|write)$/.exec(scope);
  if (m) {
    return m[2] === 'read'
      ? { method: 'GET', path: `/crm/v3/objects/${m[1]}?limit=1` }
      : // Lista vacía: no nombra ningún registro, así que no puede cambiar nada aunque el permiso esté.
        { method: 'POST', path: `/crm/v3/objects/${m[1]}/batch/update`, body: { inputs: [] } };
  }
  m = /^crm\.schemas\.(contacts|companies|deals)\.read$/.exec(scope);
  if (m) return { method: 'GET', path: `/crm/v3/properties/${m[1]}/${SCHEMA_PROBE[m[1]]}` };
  if (scope === 'crm.objects.owners.read') return { method: 'GET', path: '/crm/v3/owners?limit=1' };
  if (scope === 'crm.lists.read') return { method: 'POST', path: '/crm/v3/lists/search', body: { count: 1, offset: 0 } };
  if (scope === 'sales-email-read') return { method: 'GET', path: '/crm/v3/objects/emails?limit=1' };
  return null;
}

export const HUBSPOT_PROBE_OBJECTS = OBJECTS;

export interface InspectOptions {
  fetch?: FetchLike;
  sleep?: SleepFn;
  budget?: HubspotBudgetLike | null;
  /** Permisos que le importan a la función que conecta: si la info del token no responde, se prueban estos (en este orden). */
  probe?: readonly string[];
  /**
   * true: si la info del token responde pero no nombra alguno de `probe`, ese
   * también se prueba contra su endpoint. Una clave vieja puede poder leer algo
   * sin que su lista lo nombre igual; manda lo que responde HubSpot.
   */
  verifyMissing?: boolean;
  client?: HubspotClient;
}

/**
 * Valida una clave: a qué cuenta entra, con qué permisos y de qué tipo es.
 * Tira HubspotApiError: `auth` si HubSpot no la acepta, `network` o
 * `rate_limited` si no se pudo preguntar.
 */
export async function inspectHubspotToken(token: string, opts: InspectOptions = {}): Promise<HubspotTokenInfo> {
  if (!looksLikeHubspotToken(token)) throw new HubspotApiError('auth', 401);
  const client = opts.client ?? createHubspotClient({ token, fetch: opts.fetch, sleep: opts.sleep, budget: opts.budget });
  const fatal = (err: unknown) => !(err instanceof HubspotApiError) || err.code === 'network' || err.code === 'rate_limited' || err.code === 'locked';

  let portalId = '';
  let scopes: string[] | null = null;
  let kind: HubspotTokenKind = 'unknown';
  // La consulta dijo que no (4xx): no es una private app, o la clave no vale. Lo decide la llamada siguiente.
  let refused = false;
  try {
    const info = await client.request<Record<string, unknown>>('/oauth/v2/private-apps/get/access-token-info', { method: 'POST', body: { tokenKey: token }, auth: false });
    portalId = info.hubId ? String(info.hubId) : '';
    if (Array.isArray(info.scopes)) scopes = info.scopes.filter((x): x is string => typeof x === 'string');
    if (scopes) kind = info.appId ? 'private_app' : 'service_key';
  } catch (err) {
    if (fatal(err)) throw err;
    refused = (err as HubspotApiError).status >= 400 && (err as HubspotApiError).status < 500;
  }

  let uiDomain = 'app.hubspot.com';
  try {
    const details = await client.request<Record<string, unknown>>('/account-info/v3/details');
    if (!portalId && details.portalId) portalId = String(details.portalId);
    if (typeof details.uiDomain === 'string' && /^app[a-z0-9-]*\.hubspot\.com$/.test(details.uiDomain)) uiDomain = details.uiDomain;
    if (!scopes && refused) kind = 'service_key';
  } catch (err) {
    if (fatal(err)) throw err;
    const e = err as HubspotApiError;
    if (e.code === 'auth') throw e;
    // Una clave con forma inválida recibe un 400, no un 401.
    if (!portalId && refused && e.status === 400) throw new HubspotApiError('auth', 401, e.path);
    if (!portalId && e.code !== 'scope') throw e;
  }

  const unknownScopes: string[] = [];
  const probeOne = async (scope: string): Promise<boolean> => {
    const p = probeFor(scope);
    if (!p) return false;
    const res = await client.send(p.path, { method: p.method, body: p.body });
    if (res.status === 401) throw new HubspotApiError('auth', 401, res.path);
    if (p.method === 'GET') return res.status !== 403 && res.status < 500;
    // Escritura: 403 falta; un éxito o un error de validación (400, 422) pasó el control de permisos.
    // Cualquier otra cosa (404, 429, 5xx) no dice nada: queda sin confirmar.
    if (res.status === 403) return false;
    if ((res.status >= 200 && res.status < 300) || res.status === 400 || res.status === 422) return true;
    unknownScopes.push(scope);
    return false;
  };
  let scopesFrom: HubspotTokenInfo['scopesFrom'] = 'token_info';
  if (!scopes) {
    scopesFrom = 'probe';
    scopes = [];
    for (const scope of opts.probe ?? []) if (await probeOne(scope)) scopes.push(scope);
  } else if (opts.verifyMissing) {
    for (const scope of opts.probe ?? []) if (!scopes.includes(scope) && (await probeOne(scope))) scopes.push(scope);
  }
  if (!/^\d{1,20}$/.test(portalId)) throw new HubspotApiError('auth', 401);
  bindHubspotTokenPortal(token, portalId);
  return { portalId, uiDomain, scopes, kind, scopesFrom, unknownScopes };
}

// ---------- Guardado ----------

/** La clave cifrada para la base (lib/secret-box). Cada función la guarda en su propia tabla. */
export function sealHubspotToken(token: string): string {
  return seal(token);
}

/** La clave en claro, o '' si no se puede abrir. Solo para llamar a HubSpot: nunca vuelve por una API ni va a un log. */
export function openHubspotToken(sealed: string | null | undefined): string {
  try {
    return open(sealed) || '';
  } catch {
    return '';
  }
}
