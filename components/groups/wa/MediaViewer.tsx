'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { parseDbUtc } from '@/lib/utils';
import Avatar from './Avatar';
import { Close, Download } from './icons';
import { posterFrame } from './format';
import { TOUCH_QUERY, useBackLayer, useMediaQuery } from './backLayer';
import { MediaUnavailable, refetchMedia } from './MediaParts';

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
export default function MediaViewer({
  items,
  index,
  onIndex,
  onClose,
  container,
}: {
  items: ViewerItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Dónde se monta (por defecto el body): dentro de un <dialog> modal, el dialog (fuera de él todo queda inerte). */
  container?: Element | null;
}) {
  const t = useTranslations('groups.wa');
  const locale = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => setZoom(null), [index]);
  // Teléfono: "atrás" cierra el visor y vuelve al chat.
  useBackLayer(true, onClose, { enabled: useMediaQuery(TOUCH_QUERY) });
  const it = items[index];
  // Lo que no cargó (el archivo ya no está donde estaba) y lo que volvió con "bajar de nuevo", por elemento.
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [fresh, setFresh] = useState<Record<string, string>>({});

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
  const src = fresh[it.id] ?? it.url;
  const markBroken = () => setBroken((b) => ({ ...b, [it.id]: true }));
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
        <a className="wa-icon-btn" href={src} download={it.name || undefined} target="_blank" rel="noreferrer" aria-label={t('download')} title={t('download')}>
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
        {broken[it.id] ? (
          // No cargó: se puede volver a pedir acá mismo (y dice si ya no está), en vez de un visor en negro.
          <MediaUnavailable
            key={it.id}
            kind={it.type.startsWith('video/') ? 'video' : 'image'}
            onRetry={it.url.startsWith('/') ? refetchMedia(it.url) : undefined}
            onRecovered={(u) => {
              setFresh((f) => ({ ...f, [it.id]: u }));
              setBroken((b) => ({ ...b, [it.id]: false }));
            }}
          />
        ) : it.type.startsWith('video/') ? (
          <video key={it.id} src={src} controls autoPlay playsInline onError={markBroken} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={it.id}
            src={src}
            onError={markBroken}
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
                  <video src={posterFrame(x.url)} preload="metadata" muted tabIndex={-1} aria-hidden="true" />
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
    container ?? document.body,
  );
}
