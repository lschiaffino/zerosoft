'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { loadViewIds, navPosition, navTarget, readCrmView, type NavPosition } from './recordNavContext';

/** Un campo, un editor o un diálogo tienen el teclado: J y K son letras. */
function typingOrModal(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return true;
  return !!document.querySelector('[aria-modal="true"]:not([hidden]), dialog[open], [role="menu"]:not([hidden])');
}

/**
 * Anterior / siguiente en la cabecera de la ficha, como en HubSpot: recorre
 * los registros de la vista de la que se abrió (la tabla, con sus filtros y
 * su orden) y dice "n de total". K = anterior, J = siguiente (como en la cola
 * de tareas y en Track). Abierta sin una vista que la contenga, no aparece.
 */
export default function RecordNav({ base }: { base: string }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const search = useSearchParams();
  const target = navTarget(base);
  const [pos, setPos] = useState<NavPosition | null>(null);

  const entity = target?.entity;
  const id = target?.id;
  useEffect(() => {
    if (!entity || !id) return;
    const query = readCrmView(entity);
    if (query === null) return;
    let alive = true;
    void (async () => {
      let data = await loadViewIds(entity, query);
      // Un registro nuevo (o que entró a la vista hace poco) no está en la lista guardada: se pide de nuevo una vez.
      if (data && !data.ids.includes(id)) data = await loadViewIds(entity, query, true);
      if (alive) setPos(data ? navPosition(data.ids, data.total, id) : null);
    })();
    return () => {
      alive = false;
    };
  }, [entity, id]);

  const tab = search.get('tab');
  const href = (other: string | null) =>
    other && entity ? `/app/crm/${entity}/${encodeURIComponent(other)}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}` : null;
  const prevHref = href(pos?.prev ?? null);
  const nextHref = href(pos?.next ?? null);

  useEffect(() => {
    if (!pos) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k !== 'j' && k !== 'k') return;
      if (typingOrModal(e)) return;
      const to = k === 'j' ? nextHref : prevHref;
      if (!to) return;
      e.preventDefault();
      router.push(to);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pos, prevHref, nextHref, router]);

  if (!pos) return null;
  const arrow = (d: string) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={d} />
    </svg>
  );
  const button = (to: string | null, label: string, key: string, path: string, testId: string) =>
    to ? (
      <Link href={to} className="btn btn-secondary btn-sm btn-icon" aria-label={label} title={`${label} (${key})`} aria-keyshortcuts={key} data-testid={testId}>
        {arrow(path)}
      </Link>
    ) : (
      <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label={label} title={label} disabled data-testid={testId}>
        {arrow(path)}
      </button>
    );

  return (
    <nav className="rec-nav" aria-label={t('recordNav.label')} data-testid="record-nav">
      {button(prevHref, t('recordNav.prev'), 'K', 'M15 6l-6 6 6 6', 'record-nav-prev')}
      <span className="rec-nav-pos num" data-testid="record-nav-position" data-index={pos.index} data-total={pos.total} aria-live="polite">
        {t('recordNav.position', { index: pos.index.toLocaleString(), total: pos.total.toLocaleString() })}
      </span>
      {button(nextHref, t('recordNav.next'), 'J', 'M9 6l6 6-6 6', 'record-nav-next')}
    </nav>
  );
}
