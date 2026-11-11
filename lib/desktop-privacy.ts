import raw from '@/desktop/privacy-facts.json';

/**
 * Lo que la app de escritorio lee, guarda y manda: una sola lista de hechos
 * (desktop/privacy-facts.json) para la página pública /download/privacy y
 * para Ajustes › Privacidad y datos de la app, que la trae compilada
 * (desktop/src-tauri/src/privacy.rs). Un test de Rust compara sus ids con lo
 * que hace el código, y tests/unit/desktop-privacy.test.ts revisa la forma.
 */

export type FactsLocale = 'en' | 'es' | 'pt';
type Text = Record<string, string>;
type Item<T> = { id: string; code: string[] } & Record<FactsLocale, T>;

export interface DesktopPrivacyFacts {
  version: number;
  /** Base de los links al código en el repositorio público. */
  repo: string;
  path: string;
  limits: Record<string, number>;
  page: Record<FactsLocale, Text>;
  permissions: Array<Item<{ name: string; why: string }> & { os: string[]; pane?: string }>;
  stores: Array<Item<{ name: string; what: string; kept: string }> & { mac: string; win: string; content: boolean; delete: boolean }>;
  network: Array<Item<{ feature: string; sent: string; when: string }> & { host: 'server' | 'update' | 'browser'; endpoint?: string }>;
  never: Array<Item<string>>;
  indicators: Array<Item<string>>;
  events: Array<Item<string>>;
  tags: Record<string, Record<FactsLocale, string>>;
  controls: Array<Item<{ name: string; help: string }> & { default: boolean }>;
  security: Array<Item<string>>;
  open: Array<Item<string>>;
}

export const DESKTOP_PRIVACY = raw as unknown as DesktopPrivacyFacts;

export function factsLocale(locale: string): FactsLocale {
  return locale === 'es' || locale === 'pt' ? locale : 'en';
}

/** Link a un archivo del repositorio público. */
export function sourceUrl(file: string): string {
  return `${DESKTOP_PRIVACY.repo}${file}`;
}
