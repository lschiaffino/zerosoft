'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import CrmIcon from './CrmIcon';

/**
 * "Exportar la vista" (solo admins, como el export de siempre): baja en CSV
 * todo lo que el listado muestra con sus filtros y su orden, no solo la
 * página. Manda el estado del listado (la URL) y el server lo vuelve a
 * evaluar con el alcance y los permisos de quien exporta. La descarga pasa
 * por fetch para leer si la vista pasó el tope (10.000 filas) y avisarlo;
 * sin JavaScript, el link baja el archivo igual.
 */
export default function ExportViewButton({ entity }: { entity: 'contacts' | 'companies' | 'deals' }) {
  const t = useTranslations('crm.listBar');
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  // El aviso se cierra con Esc, con un clic afuera o con su botón.
  useEffect(() => {
    if (!notice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotice(null);
    };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && wrapRef.current?.contains(e.target)) return;
      setNotice(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [notice]);
  const list = new URLSearchParams(params.toString());
  list.delete('page');
  list.delete('per');
  const href = `/api/crm/export?${new URLSearchParams({ entity, format: 'csv', list: list.toString() }).toString()}`;

  async function download(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await fetch(href).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setNotice({ kind: 'error', text: t('exportError') });
      return;
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `crm-${entity}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBusy(false);
    const total = Number(res.headers.get('x-export-total') ?? '');
    const count = Number(res.headers.get('x-export-count') ?? '');
    if (Number.isFinite(total) && Number.isFinite(count) && total > count) {
      setNotice({ kind: 'info', text: t('exportTruncated', { cap: count.toLocaleString(), total: total.toLocaleString() }) });
    }
  }

  return (
    <span className="export-view-wrap" ref={wrapRef}>
      <a
        className="column-toggle-btn export-view-btn"
        href={href}
        download
        onClick={download}
        aria-busy={busy || undefined}
        data-testid="export-view"
        title={t('exportViewHint')}
      >
        <CrmIcon name="download" size={13} />
        <span>{busy ? t('exportPreparing') : t('exportView')}</span>
      </a>
      {notice && (
        <span className={`export-view-notice${notice.kind === 'error' ? ' is-error' : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'} data-testid="export-view-notice">
          <span>{notice.text}</span>
          <button type="button" className="icon-btn" onClick={() => setNotice(null)} aria-label={t('exportNoticeClose')} title={t('exportNoticeClose')}>
            <CrmIcon name="x" size={12} />
          </button>
        </span>
      )}
    </span>
  );
}
