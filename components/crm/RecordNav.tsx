'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { navKey, neighbors, readListNav, saveListNav, type ListNav, type NavEntity } from './recordNavModel';
import { useCrmLive } from './useCrmLive';

/**
 * Tablas y board: guardan el orden de lo que hay en pantalla para que la ficha
 * camine con ‹ › (y j / k) por la misma lista, con sus filtros y su orden.
 */
export function useListNav(entity: NavEntity, ids: readonly string[]): void {
  const pathname = usePathname();
  const search = useSearchParams();
  const qs = search?.toString() ?? '';
  const joined = ids.join(',');
  useEffect(() => {
    saveListNav(entity, { ids: joined ? joined.split(',') : [], href: `${pathname}${qs ? `?${qs}` : ''}` });
  }, [entity, joined, pathname, qs]);
}

function Chevron({ dir }: { dir: 'prev' | 'next' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={dir === 'prev' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  );
}

/** Los dos botones y la posición ("3 de 25"); un lado sin registro queda deshabilitado. */
function NavButtons({
  index,
  total,
  prevHref,
  nextHref,
  onPrev,
  onNext,
  testId,
}: {
  index: number;
  total: number;
  prevHref?: string | null;
  nextHref?: string | null;
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  testId: string;
}) {
  const t = useTranslations('crm.recordNav');
  const button = (dir: 'prev' | 'next', href: string | null | undefined, onClick: (() => void) | null | undefined) => {
    const label = t(dir === 'prev' ? 'previous' : 'next');
    const props = {
      className: 'btn btn-ghost btn-sm btn-icon rec-nav-btn',
      'aria-label': label,
      title: `${label} (${dir === 'prev' ? 'K' : 'J'})`,
      'aria-keyshortcuts': dir === 'prev' ? 'K' : 'J',
      'data-testid': `${testId}-${dir}`,
    };
    if (href) {
      return (
        <Link href={href} {...props}>
          <Chevron dir={dir} />
        </Link>
      );
    }
    return (
      <button type="button" {...props} onClick={onClick ?? undefined} disabled={!onClick}>
        <Chevron dir={dir} />
      </button>
    );
  };
  return (
    <div className="rec-nav" role="group" aria-label={t('label')} data-testid={testId}>
      {button('prev', prevHref, onPrev)}
      <span className="rec-nav-pos" data-testid={`${testId}-pos`}>
        {t('position', { n: index + 1, total })}
      </span>
      {button('next', nextHref, onNext)}
    </div>
  );
}

/**
 * Ficha: ‹ › para el registro anterior y el siguiente de la lista de donde
 * vino la persona, "Volver" a esa lista con sus filtros, y j / k. Sin lista
 * guardada (link directo) muestra solo el Volver de siempre.
 */
export function RecordTopNav({ base, back }: { base: string; back: { href: string; label: string } }) {
  const router = useRouter();
  const search = useSearchParams();
  const match = /^\/app\/crm\/(contacts|companies|deals)\/([^/?#]+)/.exec(base);
  const entity = (match?.[1] ?? null) as NavEntity | null;
  const id = match?.[2] ?? '';
  const [nav, setNav] = useState<ListNav | null>(null);
  useEffect(() => {
    setNav(entity ? readListNav(entity) : null);
  }, [entity, id]);

  // Cambios de un compañero en esta ficha: se vuelve a pedir la página (con el alcance de siempre).
  const kind = entity === 'contacts' ? 'contact' : entity === 'companies' ? 'company' : entity === 'deals' ? 'deal' : null;
  useCrmLive(kind && id ? { record: { kind, id } } : null);

  const n = nav ? neighbors(nav.ids, id) : null;
  // La pestaña de la ficha se mantiene al pasar al siguiente.
  const tab = search?.get('tab');
  const hrefFor = (other: string | null) => (other && entity ? `/app/crm/${entity}/${other}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}` : null);
  const prevHref = n ? hrefFor(n.prev) : null;
  const nextHref = n ? hrefFor(n.next) : null;

  useEffect(() => {
    if (!prevHref && !nextHref) return;
    const onKey = (e: KeyboardEvent) => {
      // Con un diálogo o la vista previa abiertos, las teclas son de ellos.
      if (document.querySelector('dialog[open], .modal-overlay, [data-testid="record-preview"]')) return;
      const dir = navKey(e);
      const href = dir === 'prev' ? prevHref : dir === 'next' ? nextHref : null;
      if (!href) return;
      e.preventDefault();
      router.push(href);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prevHref, nextHref, router]);

  const backHref = nav?.href && n && n.index >= 0 ? nav.href : back.href;
  return (
    <>
      <Link href={backHref} className="ui-page-back" data-testid="record-back">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        {back.label}
      </Link>
      {n && n.index >= 0 && n.total > 1 && <NavButtons index={n.index} total={n.total} prevHref={prevHref} nextHref={nextHref} testId="record-nav" />}
    </>
  );
}

/**
 * Vista previa: ‹ › y j / k entre las filas de la tabla o las tarjetas del
 * board que la abrió.
 */
export function PreviewNav({ ids, id, onStep }: { ids: readonly string[]; id: string; onStep: (id: string) => void }) {
  const n = neighbors(ids, id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open], .modal-overlay')) return;
      const dir = navKey(e);
      const target = dir === 'prev' ? n.prev : dir === 'next' ? n.next : null;
      if (!target) return;
      e.preventDefault();
      onStep(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n.prev, n.next, onStep]);
  if (n.index < 0 || n.total < 2) return null;
  return (
    <NavButtons
      index={n.index}
      total={n.total}
      onPrev={n.prev ? () => onStep(n.prev!) : null}
      onNext={n.next ? () => onStep(n.next!) : null}
      testId="preview-nav"
    />
  );
}
