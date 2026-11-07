'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { parseDbUtc } from '@/lib/utils';
import { Close, Download } from './icons';

export interface ViewerItem {
  id: string;
  url: string;
  type: string;
  name: string;
  caption: string;
  author: string;
  createdAt: string;
}

/**
 * Visor a pantalla completa de imágenes y videos del chat (como el de
 * WhatsApp Web): flechas o ←/→ para recorrer, Esc cierra, bajar el archivo.
 */
export default function MediaViewer({ items, index, onIndex, onClose }: { items: ViewerItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const t = useTranslations('groups.wa');
  const locale = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const it = items[index];

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, items.length, onClose, onIndex]);

  if (!it || typeof document === 'undefined') return null;
  const when = parseDbUtc(it.createdAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return createPortal(
    <div className="wa-viewer" role="dialog" aria-modal="true" aria-label={t('viewer')}>
      <header className="wa-viewer-head">
        <span className="wa-viewer-who">
          <strong>{it.author}</strong>
          <span>{when}</span>
        </span>
        <span className="wa-viewer-count">
          {index + 1} / {items.length}
        </span>
        <a className="wa-icon-btn" href={it.url} download={it.name || undefined} target="_blank" rel="noreferrer" aria-label={t('download')} title={t('download')}>
          <Download />
        </a>
        <button ref={closeRef} type="button" className="wa-icon-btn" onClick={onClose} aria-label={t('closeViewer')} title={t('closeViewer')}>
          <Close />
        </button>
      </header>
      <div className="wa-viewer-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <button type="button" className="wa-viewer-nav is-prev" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label={t('previous')}>
          ‹
        </button>
        {it.type.startsWith('video/') ? (
          <video key={it.id} src={it.url} controls autoPlay playsInline />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={it.id} src={it.url} alt={it.caption || it.name} />
        )}
        <button type="button" className="wa-viewer-nav is-next" onClick={() => onIndex(index + 1)} disabled={index >= items.length - 1} aria-label={t('next')}>
          ›
        </button>
      </div>
      {it.caption && <p className="wa-viewer-caption">{it.caption}</p>}
    </div>,
    document.body,
  );
}
