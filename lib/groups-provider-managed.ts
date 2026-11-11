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

/**
 * Cierra la sesión y borra la instancia, avisando si el borrado falló (para
 * reintentarlo después). Que ya no exista cuenta como borrada.
 */
export async function deleteManagedInstance(session: string, opts: { fetch?: FetchLike; env?: ManagedEnv | null } = {}): Promise<void> {
  const env = opts.env === undefined ? managedEnv() : opts.env;
  if (!env) throw new ProviderError('invalid_config');
  if (!INSTANCE_RE.test(session)) throw new ProviderError('invalid_config');
  const f = opts.fetch ?? defaultBridgeFetch;
  const call = (path: string) => bridgeRequest(f, `${env.baseUrl}${path}`, { apikey: env.globalKey }, 'DELETE');
  await call(`/instance/logout/${session}`).catch(() => null);
  try {
    await call(`/instance/delete/${session}`);
  } catch (err) {
    if (err instanceof ProviderError && err.httpStatus === 404) return;
    throw err;
  }
}

/** Instancias que no se pudieron borrar: se reintentan desde /api/cron/tick (claim por fila). */
export async function queueManagedDelete(session: string): Promise<void> {
  const { getDb } = await import('./db');
  await getDb()
    .prepare('INSERT OR IGNORE INTO groups_bridge_tombstones (instance, attempts, created_at) VALUES (?, 0, ?)')
    .run(session, new Date().toISOString());
}

export async function retryManagedDeletes(opts: { limit?: number; now?: Date; fetch?: FetchLike } = {}): Promise<{ deleted: number; failed: number }> {
  const out = { deleted: 0, failed: 0 };
  if (!managedAvailable()) return out;
  const { getDb } = await import('./db');
  const db = getDb();
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const rows = (await db
    .prepare('SELECT instance FROM groups_bridge_tombstones WHERE claimed_until IS NULL OR claimed_until < ? ORDER BY created_at LIMIT ?')
    .all(nowIso, opts.limit ?? 20)) as Array<{ instance: string }>;
  for (const r of rows) {
    // Compare-and-set: dos corridas a la vez no borran la misma instancia.
    const claim = await db
      .prepare('UPDATE groups_bridge_tombstones SET claimed_until = ?, attempts = attempts + 1 WHERE instance = ? AND (claimed_until IS NULL OR claimed_until < ?)')
      .run(new Date(now.getTime() + 10 * 60_000).toISOString(), r.instance, nowIso);
    if (claim.changes === 0) continue;
    try {
      await deleteManagedInstance(r.instance, { fetch: opts.fetch });
      await db.prepare('DELETE FROM groups_bridge_tombstones WHERE instance = ?').run(r.instance);
      out.deleted++;
    } catch {
      out.failed++;
      // Después de muchos intentos (instancia ya inválida o servidor reemplazado) se deja de reintentar.
      await db.prepare('DELETE FROM groups_bridge_tombstones WHERE instance = ? AND attempts >= 50').run(r.instance);
    }
  }
  return out;
}

export function managedProvider(
  cfg: Partial<BridgeConfig>,
  opts: { fetch?: FetchLike; env?: ManagedEnv | null; fullHistory?: boolean } = {},
): GroupsProvider {
  const env = opts.env === undefined ? managedEnv() : opts.env;
  if (!env) throw new ProviderError('invalid_config');
  if (!validManagedConfig(cfg)) throw new ProviderError('invalid_config');
  const f = opts.fetch ?? defaultBridgeFetch;
  const instance = cfg.session;
  const token = cfg.instanceToken;
  // Sin fetch propio, el de Evolution (con el timeout largo de los envíos de media).
  const inner = evolutionProvider({ baseUrl: env.baseUrl, apiKey: token, session: instance }, { fetch: opts.fetch });
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
          // fullHistory (Lines e Inbox): WhatsApp manda el historial solo al vincular y solo si
          // se pide acá; sin esto llegan los chats con lo más reciente y nada de lo anterior.
          syncFullHistory: !!opts.fullHistory,
          webhook,
        });
      } catch (err) {
        // Ya existía (reconectar): sigue con su token.
        if (!(err instanceof ProviderError) || ![400, 403, 409].includes(err.httpStatus ?? 0)) throw err;
      }
      if (opts.fullHistory) {
        // Instancia creada antes sin historial: el ajuste vale para la próxima vinculación.
        await asInstance(`/settings/set/${instance}`, 'POST', {
          rejectCall: false,
          msgCall: '',
          groupsIgnore: false,
          alwaysOnline: false,
          readMessages: false,
          readStatus: false,
          syncFullHistory: true,
        }).catch(() => null);
      }
      // El webhook se registra aparte también: versiones de v2 que ignoran el del alta.
      await asInstance(`/webhook/set/${instance}`, 'POST', { webhook });
      return inner.start();
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
        const body = JSON.parse(req.rawBody) as { instance?: unknown; apikey?: unknown };
        if (typeof body.instance !== 'string' || !safeEqual(body.instance, instance)) return false;
        // Evolution manda el token de la instancia en el cuerpo, o null si el servidor no lo expone
        // (AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false): null es como no mandarlo. Si viene, tiene que ser el nuestro.
        if (body.apikey !== undefined && body.apikey !== null && (typeof body.apikey !== 'string' || !safeEqual(body.apikey, token))) return false;
        return true;
      } catch {
        return false;
      }
    },
  };
}
