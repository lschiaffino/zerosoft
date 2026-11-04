/**
 * Groups: conexión por QR administrada. Usa Evolution API v2 en un servidor
 * nuestro, configurado solo del lado del servidor con GROUPS_BRIDGE_URL y
 * GROUPS_BRIDGE_KEY. Sin esas dos variables la opción no existe.
 *
 * - Cada número es una instancia propia con un nombre al azar y un token
 *   propio que generamos al crearla. Todo lo del día a día (QR, estado,
 *   mensajes, grupos) va con ese token, que Evolution solo acepta para su
 *   instancia. La clave global se usa solo para crear y borrar instancias, y
 *   nunca se guarda en el número ni sale en errores.
 * - El nombre y el token de la instancia los genera el servidor: la persona
 *   no puede elegirlos ni cambiarlos.
 * - Desconectar o borrar el número cierra la sesión y borra la instancia.
 */
import { randomBytes } from 'crypto';
import { bridgeRequest, defaultBridgeFetch, evolutionProvider, EVOLUTION_EVENTS } from './groups-provider-bridge';
import { PROVIDER_CAPS, ProviderError, safeEqual, type BridgeConfig, type FetchLike, type GroupsProvider } from './groups-provider';

export interface ManagedEnv {
  baseUrl: string;
  globalKey: string;
}

/** La config del servidor, o null si no está (la opción no se ofrece). */
export function managedEnv(): ManagedEnv | null {
  const baseUrl = String(process.env.GROUPS_BRIDGE_URL ?? '').trim().replace(/\/+$/, '');
  const globalKey = String(process.env.GROUPS_BRIDGE_KEY ?? '').trim();
  if (!baseUrl || !globalKey || !/^https?:\/\/[^\s]+$/.test(baseUrl)) return null;
  return { baseUrl, globalKey };
}

export function managedAvailable(): boolean {
  return managedEnv() !== null;
}

const INSTANCE_RE = /^zs-[a-f0-9]{20}$/;
const TOKEN_RE = /^[a-f0-9]{48}$/;

/** Nombre y token nuevos para la instancia de un número. */
export function newManagedInstance(): { session: string; instanceToken: string } {
  return { session: `zs-${randomBytes(10).toString('hex')}`, instanceToken: randomBytes(24).toString('hex') };
}

/** Solo nombres y tokens que generamos nosotros: una fila alterada no llega a otra instancia. */
export function validManagedConfig(cfg: Partial<BridgeConfig>): cfg is { session: string; instanceToken: string } {
  return INSTANCE_RE.test(String(cfg.session ?? '')) && TOKEN_RE.test(String(cfg.instanceToken ?? ''));
}

export function managedProvider(
  cfg: Partial<BridgeConfig>,
  opts: { fetch?: FetchLike; env?: ManagedEnv | null } = {},
): GroupsProvider {
  const env = opts.env === undefined ? managedEnv() : opts.env;
  if (!env) throw new ProviderError('invalid_config');
  if (!validManagedConfig(cfg)) throw new ProviderError('invalid_config');
  const f = opts.fetch ?? defaultBridgeFetch;
  const instance = cfg.session;
  const token = cfg.instanceToken;
  const inner = evolutionProvider({ baseUrl: env.baseUrl, apiKey: token, session: instance }, { fetch: f });
  const asGlobal = (path: string, method: string, body?: unknown) =>
    bridgeRequest(f, `${env.baseUrl}${path}`, { apikey: env.globalKey }, method, body);
  const asInstance = (path: string, method: string, body?: unknown) =>
    bridgeRequest(f, `${env.baseUrl}${path}`, { apikey: token }, method, body);

  return {
    ...inner,
    kind: 'managed',
    caps: PROVIDER_CAPS.managed,
    async connect(webhookUrl) {
      const webhook = { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: EVOLUTION_EVENTS };
      try {
        await asGlobal('/instance/create', 'POST', {
          instanceName: instance,
          token,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          // Sin historial viejo ni llamadas que suenen en el servidor.
          syncFullHistory: false,
          webhook,
        });
      } catch (err) {
        // Ya existía (reconectar): sigue con su token.
        if (!(err instanceof ProviderError) || ![400, 403, 409].includes(err.httpStatus ?? 0)) throw err;
      }
      // El webhook se registra aparte también: versiones de v2 que ignoran el del alta.
      await asInstance(`/webhook/set/${instance}`, 'POST', { webhook });
      return inner.state();
    },
    async disconnect() {
      await asInstance(`/instance/logout/${instance}`, 'DELETE').catch(() => null);
      await asGlobal(`/instance/delete/${instance}`, 'DELETE').catch(() => null);
    },
    /**
     * Evolution no firma los webhooks: el secreto va en la URL. Además, el
     * cuerpo tiene que venir de la instancia de este número.
     */
    verifyWebhook(req) {
      try {
        const body = JSON.parse(req.rawBody) as { instance?: unknown };
        return typeof body.instance === 'string' && safeEqual(body.instance, instance);
      } catch {
        return false;
      }
    },
  };
}
