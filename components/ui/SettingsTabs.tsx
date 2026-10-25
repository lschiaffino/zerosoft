'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const pathname = usePathname();
  const search = useSearchParams();

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

  // Con tabs en una fila con scroll (mobile), la activa queda a la vista y los
  // bordes se desvanecen del lado donde hay más pestañas.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const mark = () => {
      const scrollable = nav.scrollWidth > nav.clientWidth + 1;
      nav.toggleAttribute('data-more-left', scrollable && nav.scrollLeft > 1);
      nav.toggleAttribute('data-more-right', scrollable && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    };
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && nav.scrollWidth > nav.clientWidth + 1) {
      const a = active.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      const target = nav.scrollLeft + (a.left - n.left) - (nav.clientWidth - a.width) / 2;
      nav.scrollLeft = Math.max(0, target);
    }
    mark();
    nav.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', mark);
    return () => {
      nav.removeEventListener('scroll', mark);
      window.removeEventListener('resize', mark);
    };
  }, [activeKey]);

  const nav = (
    <nav ref={navRef} className={layout === 'side' ? 'ui-settings-nav' : 'ui-tabs'} aria-label={label ?? t('sections')}>
      {items.map((tab) => (
        <Link
          key={tab.key}
          href={hrefFor(tab)}
          scroll={false}
          className={layout === 'side' ? 'ui-settings-link' : 'ui-tab'}
          aria-current={tab.key === activeKey ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
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
