'use client';

import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  COMPOSE_EVENT,
  COMPOSE_REQUEST_EVENT,
  LAYOUT_TABS,
  NARROW_ONLY_TABS,
  WIDE_QUERY,
  layoutTabHref,
  middlePanelFor,
  parseLayoutTab,
  shownTab,
  tabForHash,
  type ComposeType,
  type LayoutTab,
} from './recordLayout';

/**
 * Las tres columnas de la ficha y sus pestañas. El server manda todo de una
 * vez (propiedades, Resumen, Actividad, asociaciones); cambiar de pestaña es
 * del navegador: se actualiza `?tab=` sin volver a pedir la ficha.
 *
 * El Resumen se monta solo mientras está a la vista. La Actividad, una vez
 * abierta, queda montada y oculta al cambiar de pestaña, para no perder lo
 * que se estaba escribiendo en el composer.
 */
export default function RecordShell({
  tab: serverTab,
  base,
  identity,
  about,
  aboutLabel,
  lead,
  overview,
  activity,
  right,
  rightLabel,
}: {
  tab: LayoutTab;
  base: string;
  identity: ReactNode;
  about: ReactNode;
  aboutLabel: string;
  lead?: ReactNode;
  overview: ReactNode;
  activity: ReactNode;
  right: ReactNode;
  rightLabel: string;
}) {
  const t = useTranslations('crm.record');
  const locale = useLocale();
  // La pestaña es la de la URL. Next mantiene useSearchParams al día con history.replaceState,
  // así que un clic en una pestaña, un link a `?tab=` y atrás/adelante pasan todos por acá.
  const search = useSearchParams();
  const tab: LayoutTab = search ? parseLayoutTab(search.get('tab') ?? undefined) : serverTab;
  const [wide, setWide] = useState(false);
  const [activityOpened, setActivityOpened] = useState(middlePanelFor(serverTab) === 'activity');
  const [pendingCompose, setPendingCompose] = useState<ComposeType | null>(null);
  const panel = middlePanelFor(tab);

  useEffect(() => {
    if (panel === 'activity') setActivityOpened(true);
  }, [panel]);

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const select = useCallback((next: LayoutTab, keepHash = false) => {
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    url.searchParams.delete('compose');
    if (!keepHash) url.hash = '';
    // Next sincroniza su router con history: la URL cambia sin pedir la página otra vez.
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // Links guardados de la ficha anterior (`?tab=related#line-items`): productos y
  // cotizaciones están en el Resumen, así que se abre esa pestaña y se va al ancla.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const current = parseLayoutTab(new URLSearchParams(window.location.search).get('tab') ?? undefined);
    const target = tabForHash(current, hash);
    if (target !== current) select(target, true);
    const frame = window.requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView());
    return () => window.cancelAnimationFrame(frame);
    // Solo al cargar la ficha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Acciones rápidas: primero la pestaña Actividad; con el timeline ya en pantalla, el aviso.
  useEffect(() => {
    const onRequest = (e: Event) => {
      const type = (e as CustomEvent<{ type?: ComposeType }>).detail?.type;
      if (!type) return;
      setPendingCompose(type);
      select('activity');
    };
    window.addEventListener(COMPOSE_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(COMPOSE_REQUEST_EVENT, onRequest);
  }, [select]);
  useEffect(() => {
    if (!pendingCompose || tab !== 'activity' || !activityOpened) return;
    window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: { type: pendingCompose } }));
    setPendingCompose(null);
  }, [pendingCompose, tab, activityOpened]);

  const active = shownTab(tab, wide);
  const onTab = (e: MouseEvent<HTMLAnchorElement>, key: LayoutTab) => {
    // Con modificador (pestaña nueva) o botón del medio, el link de siempre.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    select(key);
  };

  return (
    <div className="rec3" data-tab={tab} data-testid="record-columns">
      <div className="rec3-left" data-testid="record-left">
        <div className="rec3-identity">{identity}</div>
        <section className="rec3-about record-props" aria-label={aboutLabel} data-testid="record-about">
          {about}
        </section>
      </div>
      <div className="rec3-mid" data-testid="record-middle">
        {lead && <div className="rec3-lead">{lead}</div>}
        <nav className="ui-tabs rec3-tabs" aria-label={t('tabsLabel')}>
          {LAYOUT_TABS.map((key) => (
            <a
              key={key}
              href={`/${locale}${layoutTabHref(base, key)}`}
              className={`ui-tab${NARROW_ONLY_TABS.includes(key) ? ' rec3-tab-narrow' : ''}`}
              aria-current={key === active ? 'page' : undefined}
              data-tab={key}
              data-testid={`record-tab-${key}`}
              onClick={(e) => onTab(e, key)}
            >
              {t(`layoutTabs.${key}`)}
            </a>
          ))}
        </nav>
        {panel === 'overview' && (
          <div className="rec3-panel" data-panel="overview" data-testid="record-panel-overview">
            {overview}
          </div>
        )}
        {activityOpened && (
          <div className="rec3-panel" data-panel="activity" data-testid="record-panel-activity" hidden={panel !== 'activity'}>
            {activity}
          </div>
        )}
      </div>
      <aside className="rec3-right record-related" aria-label={rightLabel} data-testid="record-right">
        {right}
      </aside>
    </div>
  );
}
