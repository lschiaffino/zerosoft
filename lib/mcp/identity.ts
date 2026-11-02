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
}

const store = new AsyncLocalStorage<DelegatedIdentity>();

export function delegatedIdentity(): DelegatedIdentity | undefined {
  return store.getStore();
}

export function runAsDelegated<T>(identity: DelegatedIdentity, fn: () => Promise<T>): Promise<T> {
  return store.run(identity, fn);
}
