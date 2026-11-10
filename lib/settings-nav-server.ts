import { getTranslations } from 'next-intl/server';
import { isAdminEmail } from './feedback';
import { PRODUCT_CONFIG } from './products';
import type { SessionUser } from './session';
import { settingsSections, type SettingsGroupKey } from './settings-nav';
import { userCanUseApp } from './workspace';

export interface SettingsNavEntry {
  key: string;
  href: string;
  match?: string[];
  label: string;
  /** Palabras que también encuentran la sección en la caja de búsqueda. */
  keywords?: string;
  product?: string;
  /** Color de la app (la ventana del escritorio no tiene los tokens --c-<app>). */
  color?: string;
  native?: string;
}

export interface SettingsNavGroupView {
  key: SettingsGroupKey;
  label: string;
  items: SettingsNavEntry[];
}

/**
 * La nav de Ajustes con textos, para una persona: Productos solo con las apps
 * que tiene en este workspace y Admin solo para ADMIN_EMAILS. La usan la nav
 * de /app/settings, la nav embebida en la ventana del escritorio y
 * /api/settings/nav (la lista que pinta esa ventana). Server-only.
 */
export async function settingsNavGroups(user: SessionUser, locale: string, opts: { desktop?: boolean } = {}): Promise<SettingsNavGroupView[]> {
  const t = await getTranslations({ locale, namespace: 'settings' });
  const isAdmin = isAdminEmail(user.actingUser?.email ?? user.email);
  const kw = (key: string) => (t.has(`keywords.${key}`) ? t(`keywords.${key}`) : undefined);
  return settingsSections(isAdmin, opts).map((g) => ({
    key: g.key,
    label: t(`groups.${g.key}`),
    items: g.items
      .filter((i) => !i.product || userCanUseApp(user, i.product))
      .map((i) => {
        const label = i.product ? PRODUCT_CONFIG[i.product].name : i.native ? t(`desktopSections.${i.native}`) : t(`sections.${i.key}`);
        const entry: SettingsNavEntry = { key: i.key, href: i.href, label };
        const keywords = i.product ? `${PRODUCT_CONFIG[i.product].name} ${t('keywords.product')}` : kw(i.native ? `native.${i.native}` : i.key);
        if (keywords) entry.keywords = keywords;
        if (i.match) entry.match = i.match;
        if (i.product) {
          entry.product = i.product;
          entry.color = PRODUCT_CONFIG[i.product].color;
        }
        if (i.native) entry.native = i.native;
        return entry;
      }),
  }));
}
