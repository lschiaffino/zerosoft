'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { activeRouteTab } from '@/lib/settings-nav';

export interface SettingsTab {
  /** Valor del parámetro (modo query) o identificador. */
  key: string;
  label: string;
  /** Modo route: ruta de la sub-página (/app/crm/settings/pipelines). */
  href?: string;
  /** Modo route: otras rutas que también activan esta pestaña. */
  match?: string[];
}

/**
 * Navegación de ajustes. `layout="side"` (default) es la nav secundaria a la
 * izquierda tipo Vercel/Cal, que en <900px pasa a tabs con scroll; `"top"` son
 * tabs horizontales (.ui-tabs). Dos modos:
 * - route: cada tab es una sub-ruta (`href`, más `match` si cubre otras); activa la de prefijo más largo.
 * - query: cada tab es `?<param>=<key>` sobre la ruta actual (default: el primero).
 *
 *   <SettingsTabs mode="query" param="tab" items={[{ key: 'general', label: 'General' }, …]}>
 *     {tab === 'general' && <FormSection …/>}
 *   </SettingsTabs>
 */
export default function SettingsTabs({
  items,
  mode = 'route',
  param = 'tab',
  layout = 'side',
  label,
  children,
  className = '',
}: {
  items: SettingsTab[];
  mode?: 'route' | 'query';
  param?: string;
  layout?: 'side' | 'top';
  /** Nombre de la navegación para lectores de pantalla. Por defecto "Secciones". */
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('common.ui');
  const locale = useLocale();
  const pathname = usePathname();
  const search = useSearchParams();
  // Hasta hidratar, las pestañas son <a> comunes: un clic temprano navega igual
  // (con <Link> el router todavía no está listo y el clic se perdía).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // Red de seguridad: si la navegación suave no llega (el router de Next a veces
  // descarta el clic en páginas dinámicas pesadas), se navega de verdad.
  const pendingTarget = useRef<string | null>(null);
  const guard = (e: MouseEvent<HTMLAnchorElement>, target: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    pendingTarget.current = target;
    window.setTimeout(() => {
      if (pendingTarget.current !== target) return;
      pendingTarget.current = null;
      if (`${window.location.pathname}${window.location.search}` !== target) window.location.assign(target);
    }, 2500);
  };

  const hrefFor = (tab: SettingsTab): string => {
    if (mode === 'route') return tab.href ?? pathname;
    const qs = new URLSearchParams(search?.toString() ?? '');
    qs.set(param, tab.key);
    return `${pathname}?${qs.toString()}`;
  };

  let activeKey: string | undefined;
  if (mode === 'query') {
    const v = search?.get(param);
    activeKey = items.some((i) => i.key === v) ? (v as string) : items[0]?.key;
  } else {
    activeKey = activeRouteTab(items, pathname);
  }

  const nav = (
    <nav className={layout === 'side' ? 'ui-settings-nav' : 'ui-tabs'} aria-label={label ?? t('sections')}>
      {items.map((tab) => {
        const props = {
          className: layout === 'side' ? 'ui-settings-link' : 'ui-tab',
          'aria-current': tab.key === activeKey ? ('page' as const) : undefined,
        };
        return hydrated ? (
          <Link
            key={tab.key}
            href={hrefFor(tab)}
            scroll={false}
            onClick={(e) => guard(e, `/${locale}${hrefFor(tab)}`)}
            {...props}
          >
            {tab.label}
          </Link>
        ) : (
          <a key={tab.key} href={`/${locale}${hrefFor(tab)}`} {...props}>
            {tab.label}
          </a>
        );
      })}
    </nav>
  );

  if (layout === 'top') {
    return (
      <div className={`ui-page ${className}`.trim()}>
        {nav}
        {children}
      </div>
    );
  }
  return (
    <div className={`ui-settings ${className}`.trim()}>
      {nav}
      <div className="ui-settings-content">{children}</div>
    </div>
  );
}
