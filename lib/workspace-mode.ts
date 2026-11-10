import { APP_SWITCHER_ORDER, PRODUCT_CATEGORIES, PRODUCT_CONFIG, type ProductCategory, type ProductKey } from '@/lib/products';

/**
 * Modo del workspace: uso personal o en equipo. Ordena los menús (switcher,
 * inicio) y decide si se muestran las cosas de equipo (invitar, asignar).
 * Puro, sin base: lo usan el servidor y el cliente. El modo guardado sale de
 * teams.use_mode (ver getWorkspaceMode en lib/home.ts); sin dato, 'team'.
 */
export type WorkspaceMode = 'personal' | 'team';

export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = 'team';

/** Tamaños del equipo (onboarding y Ajustes › Workspace). */
export const WORKSPACE_SIZES_LIST = ['1', '2-10', '11-50', '51-200', '200+'] as const;

export function normalizeWorkspaceMode(value: unknown): WorkspaceMode {
  return value === 'personal' ? 'personal' : DEFAULT_WORKSPACE_MODE;
}

/** Destacadas en uso personal: escribir, planificar y el tiempo propio. */
const PERSONAL_FEATURED: readonly ProductKey[] = ['track', 'notes', 'docs', 'cal', 'board', 'link'];

/** Destacadas en equipo: vender, atender (Lines; Chat es Próximamente) y entregar. El resto queda a un clic en "Más apps". */
const TEAM_FEATURED: readonly ProductKey[] = ['track', 'crm', 'groups', 'docs', 'cal', 'link'];

/**
 * Apps destacadas, en orden. `chosen` (las que la persona eligió en el
 * onboarding, users.profile.apps) reemplazan a las del modo. `entryApp` (la
 * app por la que entró) va primero aunque no esté destacada.
 */
export function featuredApps({
  mode,
  entryApp,
  chosen,
}: {
  mode: WorkspaceMode;
  entryApp?: ProductKey | null;
  chosen?: readonly ProductKey[] | null;
}): ProductKey[] {
  const base = chosen && chosen.length ? chosen : mode === 'personal' ? PERSONAL_FEATURED : TEAM_FEATURED;
  if (!entryApp) return [...base];
  return [entryApp, ...base.filter((k) => k !== entryApp)];
}

/** "Más apps": las que no están destacadas, agrupadas por categoría (sin categorías vacías). */
export function moreAppsByCategory(opts: {
  mode: WorkspaceMode;
  entryApp?: ProductKey | null;
  chosen?: readonly ProductKey[] | null;
}): Array<{ category: ProductCategory; apps: ProductKey[] }> {
  const featured = new Set(featuredApps(opts));
  return PRODUCT_CATEGORIES.map((category) => ({
    category,
    apps: APP_SWITCHER_ORDER.filter((k) => PRODUCT_CONFIG[k].category === category && !featured.has(k)),
  })).filter((g) => g.apps.length > 0);
}

/** Todas las apps agrupadas por categoría (el sidebar de la plataforma). */
export function appsByCategory(): Array<{ category: ProductCategory; apps: ProductKey[] }> {
  return PRODUCT_CATEGORIES.map((category) => ({
    category,
    apps: APP_SWITCHER_ORDER.filter((k) => PRODUCT_CONFIG[k].category === category),
  })).filter((g) => g.apps.length > 0);
}

/** Invitar, asignar y lo demás de equipo: solo en modo equipo. */
export function showTeamUi(mode: WorkspaceMode): boolean {
  return mode === 'team';
}
