'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { navKey, neighbors, readListNav, saveListNav, viewNavQuery, type ListNav, type NavEntity } from './recordNavModel';
import { useCrmLive } from './useCrmLive';

/**
 * Tablas y board: guardan el orden de lo que hay en pantalla para que la ficha
 * camine con ‹ › (y j / k) por la misma lista, con sus filtros y su orden. Una
 * tabla (`table`) deja que la ficha pida la vista entera, no solo la página.
 */
export function useListNav(entity: NavEntity, ids: readonly string[], opts: { table?: boolean } = {}): void {
  const pathname = usePathname();
  const search = useSearchParams();
  const qs = search?.toString() ?? '';
  const joined = ids.join(',');
  const table = !!opts.table;
  useEffect(() => {
    saveListNav(entity, { ids: joined ? joined.split(',') : [], href: `${pathname}${qs ? `?${qs}` : ''}`, ...(table ? { table: true as const } : {}) });
  }, [entity, joined, pathname, qs, table]);
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
  const t = useTranslations('crm.recordNav');
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const search = useSearchParams();
  const match = /^\/app\/crm\/(contacts|companies|deals)\/([^/?#]+)/.exec(base);
  const entity = (match?.[1] ?? null) as NavEntity | null;
  const id = match?.[2] ?? '';
  const [nav, setNav] = useState<ListNav | null>(null);
  useEffect(() => {
    const saved = entity ? readListNav(entity) : null;
    setNav(saved);
    setGone(false);
    // Desde una tabla: la vista entera (hasta 2000, con su orden y filtros), no solo la página que se veía.
    const qs = entity ? viewNavQuery(saved, entity, id) : null;
    if (!entity || !saved || qs === null) return;
    let cancelled = false;
    fetch(`/api/crm/view-nav?entity=${entity}&q=${encodeURIComponent(qs)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ ids?: unknown }>) : null))
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.ids)) return;
        const ids = d.ids.filter((x): x is string => typeof x === 'string');
        // Si el registro ya no está en la vista (lo cambiaron), sigue con lo que se veía.
        if (!ids.includes(id)) return;
        const full: ListNav = { ids, href: saved.href, table: true, full: true };
        saveListNav(entity, full);
        setNav(full);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entity, id]);

  // Cambios de un compañero en esta ficha: se vuelve a pedir la página (con el alcance de siempre).
  const kind = entity === 'contacts' ? 'contact' : entity === 'companies' ? 'company' : entity === 'deals' ? 'deal' : null;
  // Si deja de estar (otra persona la borró o ya no la ve), se avisa en vez de recargar a un 404.
  useCrmLive(kind && id ? { record: { kind, id } } : null, undefined, { onGone: () => setGone(true) });

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
      {gone && (
        <div className="rec-gone" role="alert" data-testid="record-gone">
          <p>{t('gone')}</p>
          <Link href={backHref} className="btn btn-secondary btn-sm" data-testid="record-gone-back">
            {t('goneBack')}
          </Link>
        </div>
      )}
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
