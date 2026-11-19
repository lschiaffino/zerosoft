/**
 * Apps destacadas del workspace: las elige un admin en Ajustes › Apps del
 * workspace y valen para todas las personas de esa cuenta. Puro, sin base: lo
 * usan el servidor (lib/workspace-apps.ts guarda y carga) y el menú de apps.
 *
 * Sin ninguna destacada a la vista, el menú queda como siempre (todas las
 * apps por categoría). Con alguna, las destacadas van arriba en un bloque y
 * el resto queda plegado en "Otras apps", con sus categorías.
 */
import { APP_SWITCHER_ORDER, isComingSoon, isProductKey, PRODUCT_CATEGORIES, PRODUCT_CONFIG, type ProductCategory, type ProductKey } from './products';

/** ¿Se puede destacar? Todas las que existen hoy, también Inbox; las "Próximamente" no. */
export function isFeaturableApp(app: string): app is ProductKey {
  return isProductKey(app) && !isComingSoon(app);
}

/** Lo que llega de la base o del cliente → lista sin repetidas, en el orden del menú. */
export function cleanFeaturedApps(raw: unknown): ProductKey[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.filter((x): x is string => typeof x === 'string'));
  return APP_SWITCHER_ORDER.filter((k) => set.has(k) && isFeaturableApp(k));
}

export interface SwitcherLayout {
  /** Destacadas que la persona abre, en el orden del menú. Vacía = el menú de siempre. */
  featured: ProductKey[];
  /** El resto por categoría (sin categorías vacías). Sin destacadas, son todas. */
  groups: Array<{ category: ProductCategory; apps: ProductKey[] }>;
  /** Cuántas apps hay en `groups`. */
  restCount: number;
  /** ¿`groups` va plegado en "Otras apps"? Solo con destacadas y con algo que plegar. */
  collapsed: boolean;
}

/**
 * Cómo se arma el menú de apps. `open` son las apps que la persona abre (ya
 * sin las apagadas ni las "Próximamente" que no ve); `featured`, las que
 * destacó el workspace. Una destacada que la persona no abre no cuenta: si no
 * le queda ninguna, ve el menú de siempre.
 */
export function switcherLayout(open: readonly ProductKey[], featured: readonly ProductKey[] | null | undefined): SwitcherLayout {
  const can = new Set(open);
  const marked = new Set(cleanFeaturedApps(featured ?? []));
  const top = APP_SWITCHER_ORDER.filter((k) => can.has(k) && marked.has(k));
  const groups = PRODUCT_CATEGORIES.map((category) => ({
    category,
    apps: APP_SWITCHER_ORDER.filter((k) => PRODUCT_CONFIG[k].category === category && can.has(k) && !top.includes(k)),
  })).filter((g) => g.apps.length > 0);
  const restCount = groups.reduce((n, g) => n + g.apps.length, 0);
  return { featured: top, groups, restCount, collapsed: top.length > 0 && restCount > 0 };
}
