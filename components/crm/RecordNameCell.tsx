'use client';

import type { MouseEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { recordInitials } from './recordLayout';

/** Ancho del teléfono (las tablas pasan a tarjetas: styles/crm.css). Ahí el nombre abre la ficha. */
const PHONE = '(max-width: 640px)';

/**
 * Primera columna de los listados de contactos y empresas, como en HubSpot:
 * avatar (iniciales o logo) y el nombre. En escritorio un clic en el nombre
 * abre la vista previa al costado; el botón "Abrir" (o Cmd/Ctrl+clic, clic
 * del medio) abre la ficha. En el teléfono el nombre abre la ficha.
 */
export default function RecordNameCell({
  href,
  name,
  avatar,
  onPreview,
  expand,
}: {
  href: string;
  name: string;
  /** Por defecto, las iniciales del nombre; `null` = sin avatar (deals, como en HubSpot). */
  avatar?: ReactNode;
  onPreview: () => void;
  /** Botón que despliega la fila (asociados y última actividad; RowExpansion.tsx). */
  expand?: ReactNode;
}) {
  const t = useTranslations('crm');

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (typeof window !== 'undefined' && window.matchMedia?.(PHONE).matches) return;
    e.preventDefault();
    onPreview();
  }

  return (
    <td data-card="main" className="cell-record">
      <span className="hs-name">
        {expand}
        {avatar !== undefined ? (
          avatar
        ) : (
          <span className="hs-avatar" aria-hidden="true">
            {recordInitials(name)}
          </span>
        )}
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
    </td>
  );
}
