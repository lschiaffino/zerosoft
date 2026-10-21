/**
 * Scopes de las API keys (puro: lo usan el servidor, la UI de keys y la doc).
 * Una key guarda '*' (todos: las keys anteriores a los scopes) o una lista
 * separada por espacios. `:write` incluye `:read` del mismo recurso.
 */
export const API_SCOPES = [
  'crm:read',
  'crm:write',
  'links:read',
  'links:write',
  'cal:read',
  'cal:write',
  'agents:run',
  'robots:run',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(v: string): v is ApiScope {
  return (API_SCOPES as readonly string[]).includes(v);
}

/** Lista guardada → scopes efectivos ('*' → todos). Ignora valores desconocidos. */
export function parseScopes(raw: string | null | undefined): ApiScope[] {
  const value = (raw ?? '*').trim();
  if (value === '*' || value === '') return [...API_SCOPES];
  return [...new Set(value.split(/[\s,]+/).filter(isApiScope))];
}

/** Scopes elegidos → valor a guardar ('*' si son todos). */
export function serializeScopes(scopes: readonly string[]): string {
  const valid = [...new Set(scopes.filter(isApiScope))];
  if (API_SCOPES.every((s) => valid.includes(s))) return '*';
  return API_SCOPES.filter((s) => valid.includes(s)).join(' ');
}

/** ¿Alcanzan los scopes de la key para `required`? write implica read. */
export function hasScope(granted: readonly ApiScope[], required: ApiScope): boolean {
  if (granted.includes(required)) return true;
  if (required.endsWith(':read')) {
    const write = required.replace(/:read$/, ':write') as ApiScope;
    return granted.includes(write);
  }
  return false;
}
