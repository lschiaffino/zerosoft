/**
 * Identidad delegada del MCP: durante una operación del catálogo, el handler
 * real corre como la persona dueña del token, con sus roles y permisos.
 *
 * Es solo un AsyncLocalStorage en memoria: no hay header, cookie ni parámetro
 * que lo prenda desde afuera, así que no abre nada para un navegador. Lo entra
 * únicamente lib/mcp/invoke.ts, después de validar el token. lib/session.ts y
 * requireApiUser lo miran antes que a la cookie o a la API key.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ApiScope } from '../api-scopes';
import type { UserRow } from '../db';

export interface DelegatedIdentity {
  /** La persona, recién leída de la base, con active_team_id = el workspace de esta conexión. */
  real: UserRow;
  /** Workspace fijado en la conexión (null = el propio): si la persona ya no es parte, no cae a otro. */
  pinnedTeamId: string | null;
  /** Path de la API que se está invocando, para el acceso por app de lib/session.ts. */
  apiPath: string;
  /** Tope de scopes de v1 (una API key con scopes); undefined = los de su rol. */
  apiScopes?: ApiScope[];
  /**
   * Cuándo la persona autorizó esta conexión OAuth (oauth_grants.created_at).
   * undefined = no es una conexión OAuth (API key o sesión del panel).
   */
  credentialIssuedAt?: string;
}

/** Fecha de SQLite ("YYYY-MM-DD HH:MM:SS", UTC) o ISO, en ms. NaN si no se entiende. */
function parseUtc(v: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(' ', 'T')}Z` : v);
}

/**
 * ¿La persona puede usar el workspace por el MCP según "Exigir verificación en
 * dos pasos"? El ajuste deja entrar solo a quien tiene los dos pasos activos,
 * y en la web cada sesión tiene que pasar el segundo paso (las sesiones de
 * antes de activarlos quedan pidiendo el código). Por el MCP vale lo mismo:
 * la persona (también el dueño) tiene que tenerlos activos, y una conexión
 * OAuth tiene que haberse autorizado después de activarlos, desde una sesión
 * que ya pasó el segundo paso; una de antes deja de valer en ese workspace
 * hasta que se reconecte. Una API key sigue la regla de la API REST (la
 * persona tiene que tener los dos pasos activos). Puro.
 */
export function delegatedMfaOk(
  person: { mfa_enabled_at?: string | null },
  workspace: { require_mfa?: number | null } | null | undefined,
  credentialIssuedAt: string | undefined,
): boolean {
  if (!workspace?.require_mfa) return true;
  if (!person.mfa_enabled_at) return false;
  if (credentialIssuedAt === undefined) return true;
  const issued = parseUtc(credentialIssuedAt);
  const enabled = parseUtc(person.mfa_enabled_at);
  return Number.isFinite(issued) && Number.isFinite(enabled) && issued >= enabled;
}

const store = new AsyncLocalStorage<DelegatedIdentity>();

export function delegatedIdentity(): DelegatedIdentity | undefined {
  return store.getStore();
}

export function runAsDelegated<T>(identity: DelegatedIdentity, fn: () => Promise<T>): Promise<T> {
  return store.run(identity, fn);
}
