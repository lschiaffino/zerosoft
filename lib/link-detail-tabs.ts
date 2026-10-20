/**
 * Pestañas del detalle de un link (/app/links/[id]?tab=…). El detalle eran
 * catorce bloques en una sola página; ahora cada tarea tiene su pestaña.
 * `?edit=1` (links viejos desde la tabla) abre Ajustes.
 */
export const LINK_TABS = ['overview', 'analytics', 'qr', 'routing', 'comments', 'settings'] as const;

export type LinkTab = (typeof LINK_TABS)[number];

type Params = Record<string, string | string[] | undefined>;

export function parseLinkTab(params: Params): LinkTab {
  const raw = typeof params.tab === 'string' ? params.tab : undefined;
  if (raw && (LINK_TABS as readonly string[]).includes(raw)) return raw as LinkTab;
  if (params.edit === '1') return 'settings';
  return 'overview';
}

/** Href de una pestaña del detalle; `extra` suma query (rango, país, página). */
export function linkTabHref(id: string, tab: LinkTab, extra: Record<string, string | undefined> = {}): string {
  const qs = new URLSearchParams();
  if (tab !== 'overview') qs.set('tab', tab);
  for (const [k, v] of Object.entries(extra)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/app/links/${id}?${s}` : `/app/links/${id}`;
}

/** Las tres formas de crear: una sola entrada "Nuevo" con pestañas por ruta. */
export const NEW_LINK_ROUTES = {
  single: '/app/links/new',
  bulk: '/app/links/bulk',
  import: '/app/links/import',
} as const;

export function isNewLinkPath(pathname: string): boolean {
  return Object.values(NEW_LINK_ROUTES).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
