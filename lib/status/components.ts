/**
 * Los componentes que mira status.zerosoft.ai, en un solo lugar.
 *
 * Hay dos niveles:
 * - Componentes internos (`STATUS_COMPONENTS`): lo que se chequea de verdad.
 *   `source: 'cron'` los chequea /api/cron/minute (lib/status/checks.ts);
 *   `source: 'report'` los reporta el watcher de la Mac mini por
 *   POST /api/status/report (docs/status.md). Sus ids son el contrato con el watcher.
 * - Componentes públicos (`PUBLIC_COMPONENTS`): las filas de la página /status.
 *   Cada interno alimenta uno público (`publicId`). La página nunca muestra el
 *   interno: ni su nombre, ni el error, ni el detalle.
 *
 * `publicFrom`: desde qué estado el interno se nota en la página. El disco de
 * Evolution al 90 % es un aviso para nosotros (degraded), no una caída para
 * quien usa WhatsApp; lleno (down) sí lo es.
 */

export type ComponentStatus = 'up' | 'degraded' | 'down' | 'unknown';

export type PublicComponentId = 'website' | 'apps' | 'whatsapp' | 'email';

export interface StatusComponent {
  id: string;
  /** Nombre para el email y la API del watcher (interno). */
  label: string;
  source: 'cron' | 'report';
  publicId: PublicComponentId;
  publicFrom: 'degraded' | 'down';
}

export const STATUS_COMPONENTS: readonly StatusComponent[] = [
  { id: 'web', label: 'Website (zerosoft.ai home and /api/version)', source: 'cron', publicId: 'website', publicFrom: 'degraded' },
  { id: 'database', label: 'Database (Turso)', source: 'cron', publicId: 'apps', publicFrom: 'degraded' },
  { id: 'whatsapp', label: 'WhatsApp bridge (Evolution API)', source: 'cron', publicId: 'whatsapp', publicFrom: 'degraded' },
  { id: 'evolution-db', label: 'Evolution database', source: 'report', publicId: 'whatsapp', publicFrom: 'degraded' },
  { id: 'evolution-db-disk', label: 'Evolution database disk', source: 'report', publicId: 'whatsapp', publicFrom: 'down' },
  { id: 'email', label: 'Email (Resend)', source: 'cron', publicId: 'email', publicFrom: 'degraded' },
];

/** Orden de las filas públicas (el nombre visible sale de messages/<locale>/pages.json, status.components). */
export const PUBLIC_COMPONENTS: readonly PublicComponentId[] = ['website', 'apps', 'whatsapp', 'email'];

/** Un componente que reporta el watcher queda en "unknown" si no llega nada en este tiempo. */
export const REPORT_STALE_MS = 10 * 60_000;

export function componentById(id: string): StatusComponent | undefined {
  return STATUS_COMPONENTS.find((c) => c.id === id);
}

export function reportComponentIds(): string[] {
  return STATUS_COMPONENTS.filter((c) => c.source === 'report').map((c) => c.id);
}
