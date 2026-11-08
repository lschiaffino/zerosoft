'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { parseDbUtc } from '@/lib/utils';
import Avatar from './Avatar';
import { Close, Download } from './icons';

export interface ViewerItem {
  id: string;
  url: string;
  type: string;
  name: string;
  caption: string;
  author: string;
  createdAt: string;
  /** Foto de quien lo mandó (la del chat en un 1 a 1; en un grupo, iniciales). */
  avatar?: { src: string; seed: string; kind: 'dm' | 'group' };
}

/**
 * Visor a pantalla completa de imágenes y videos del chat (como el de
 * WhatsApp Web): flechas o ←/→ para recorrer, Esc cierra, bajar el archivo.
 */
export default function MediaViewer({ items, index, onIndex, onClose }: { items: ViewerItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const t = useTranslations('groups.wa');
  const locale = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => setZoom(null), [index]);
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
          <Avatar name={it.author} kind={it.avatar?.kind ?? 'dm'} src={it.avatar?.src ?? ''} seed={it.avatar?.seed ?? it.author} size={40} />
          <span className="wa-viewer-who-text">
            <strong>{it.author}</strong>
            <span>{when}</span>
          </span>
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
          <img
            key={it.id}
            src={it.url}
            alt={it.caption || it.name}
            className={zoom ? 'is-zoomed' : ''}
            style={zoom ? { transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
            onClick={(e) => {
              // Clic: acerca al doble donde se tocó; otro clic vuelve.
              if (zoom) return setZoom(null);
              const r = e.currentTarget.getBoundingClientRect();
              setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
            }}
          />
        )}
        <button type="button" className="wa-viewer-nav is-next" onClick={() => onIndex(index + 1)} disabled={index >= items.length - 1} aria-label={t('next')}>
          ›
        </button>
      </div>
      {it.caption && <p className="wa-viewer-caption">{it.caption}</p>}
      {items.length > 1 && (
        <ul className="wa-viewer-strip" aria-label={t('viewer')}>
          {items.map((x, i) => (
            <li key={x.id}>
              <button type="button" className={i === index ? 'is-on' : ''} onClick={() => onIndex(i)} aria-label={x.name || `${i + 1}`} aria-current={i === index || undefined}>
                {x.type.startsWith('video/') ? (
                  <video src={`${x.url}#t=0.1`} preload="metadata" muted tabIndex={-1} aria-hidden="true" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={x.url} alt="" loading="lazy" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}
