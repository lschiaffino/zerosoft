/**
 * Handles públicos de usuario (/book/<handle>/<slug>). Puro, sin DB: lo usan
 * la migración 005 y upsertUser.
 */

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

const RESERVED_HANDLES = new Set([
  'admin', 'api', 'app', 'book', 'manage', 'demo', 'help', 'new', 'r', 'root', 'settings', 'support', 'team', 'www', 'zerosoft',
]);

export function handleBase(input: string): string {
  const local = input.split('@')[0] ?? '';
  const base = local
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return base.length >= 3 ? base : `${base || 'user'}-${Math.random().toString(36).slice(2, 6)}`;
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle) && !RESERVED_HANDLES.has(handle);
}

/** Primer candidato libre: base, base-2, base-3… */
export function pickHandle(emailOrName: string, taken: Set<string>): string {
  const base = handleBase(emailOrName);
  let candidate = isValidHandle(base) ? base : `${base}-1`;
  for (let i = 2; taken.has(candidate) || !isValidHandle(candidate); i++) candidate = `${base}-${i}`;
  return candidate;
}
