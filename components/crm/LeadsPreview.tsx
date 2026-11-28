'use client';

import { createContext, useCallback, useContext, useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import RecordPreview from './RecordPreview';
import { PreviewNav } from './RecordNav';

/** Ancho del teléfono: ahí el nombre abre la ficha (como en contactos y empresas). */
const PHONE = '(max-width: 640px)';

const Ctx = createContext<((id: string) => void) | null>(null);

/**
 * Vista previa lateral de los leads (tabla y board), como la de contactos,
 * empresas y deals: un clic en el nombre la abre; Cmd/Ctrl+clic o el botón
 * "Abrir" van a la ficha.
 */
export function LeadsPreviewProvider({
  owners,
  locale,
  ids,
  children,
}: {
  owners: Array<{ value: string; label: string }>;
  locale: string;
  /** Los leads en pantalla, en orden: ‹ › y j / k de la vista previa los recorren. */
  ids: readonly string[];
  children: ReactNode;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const open = useCallback((id: string) => setPreviewId(id), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {previewId && (
        <RecordPreview
          type="lead"
          id={previewId}
          locale={locale}
          owners={owners}
          onClose={() => setPreviewId(null)}
          nav={<PreviewNav ids={ids} id={previewId} onStep={setPreviewId} />}
        />
      )}
    </Ctx.Provider>
  );
}

/** Abre la vista previa de un lead (null fuera del provider). */
export function useLeadPreview(): ((id: string) => void) | null {
  return useContext(Ctx);
}

/** ¿Este clic abre la vista previa? Clic simple, en escritorio. */
export function opensPreview(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  return !(typeof window !== 'undefined' && window.matchMedia?.(PHONE).matches);
}

/** Nombre del lead en la tabla: abre la vista previa, con el botón "Abrir" al lado. */
export function LeadNameLink({ id, name }: { id: string; name: string }) {
  const t = useTranslations('crm');
  const open = useLeadPreview();
  const href = `/app/crm/leads/${id}`;
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!open || !opensPreview(e)) return;
    e.preventDefault();
    open(id);
  }
  return (
    <span className="hs-name">
      <Link href={href} className="cell-name" onClick={onClick} aria-haspopup="dialog" data-testid="record-name" title={name}>
        {name}
      </Link>
      <Link href={href} className="hs-open" title={t('listBar.openRecord')} aria-label={t('listBar.openRecord')} data-testid="record-open">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M14 4h6v6" />
          <path d="M20 4l-9 9" />
          <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
      </Link>
    </span>
  );
}
