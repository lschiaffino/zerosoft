'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { LAYOUT_TABS, NARROW_ONLY_TABS, WIDE_QUERY, layoutTabHref, shownTab, type LayoutTab } from './recordLayout';

/**
 * Pestañas de la ficha en columnas. En tres columnas son dos (Resumen y
 * Actividad); en una columna se suman Propiedades y Asociaciones, que en
 * pantalla ancha ya están a los costados. Todas son `?tab=`: se pueden
 * linkear y sobreviven al refresh.
 */
export default function RecordLayoutTabs({ base, tab }: { base: string; tab: LayoutTab }) {
  const t = useTranslations('crm.record');
  const locale = useLocale();
  // Hasta hidratar son <a> comunes: un clic temprano navega igual (ver SettingsTabs).
  const [hydrated, setHydrated] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    setHydrated(true);
    const mq = window.matchMedia(WIDE_QUERY);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Red de seguridad de SettingsTabs: si la navegación suave no llega, se navega de verdad.
  // Cualquier navegación que sí llegó (esta pestaña u otra cosa, como una acción rápida)
  // la desarma: si no, a los 2,5 s devolvería a la persona a la pestaña que había tocado antes.
  const pending = useRef<string | null>(null);
  const search = useSearchParams()?.toString() ?? '';
  useEffect(() => {
    pending.current = null;
  }, [search, tab]);
  const guard = (e: MouseEvent<HTMLAnchorElement>, target: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    pending.current = target;
    window.setTimeout(() => {
      if (pending.current !== target) return;
      pending.current = null;
      if (`${window.location.pathname}${window.location.search}` !== target) window.location.assign(target);
    }, 2500);
  };

  const active = shownTab(tab, wide);

  return (
    <nav className="ui-tabs rec3-tabs" aria-label={t('tabsLabel')}>
      {LAYOUT_TABS.map((key) => {
        const href = layoutTabHref(base, key);
        const props = {
          className: `ui-tab${NARROW_ONLY_TABS.includes(key) ? ' rec3-tab-narrow' : ''}`,
          'aria-current': key === active ? ('page' as const) : undefined,
          'data-tab': key,
        };
        return hydrated ? (
          <Link key={key} href={href} scroll={false} onClick={(e) => guard(e, `/${locale}${href}`)} {...props}>
            {t(`layoutTabs.${key}`)}
          </Link>
        ) : (
          <a key={key} href={`/${locale}${href}`} {...props}>
            {t(`layoutTabs.${key}`)}
          </a>
        );
      })}
    </nav>
  );
}
