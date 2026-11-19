/**
 * Piezas chicas de HTTP que comparten el cliente de HubSpot y el importador
 * del CRM (que las reexporta desde lib/crm-import-source.ts): el tipo del
 * fetch, la espera y cuánto esperar antes de reintentar. Sin dependencias.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export const realSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera de un reintento: Retry-After (segundos) si viene, si no 1 s, 2 s, 4 s… con tope de 30 s. */
export function backoffMs(attempt: number, retryAfter: string | null): number {
  const secs = Number(retryAfter);
  if (retryAfter && Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 60_000);
  return Math.min(1000 * 2 ** attempt, 30_000);
}
