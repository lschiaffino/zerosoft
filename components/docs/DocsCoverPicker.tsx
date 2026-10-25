'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { COVER_COLOR_PREFIX, isDocsUploadUrl } from '@/lib/docs-files';
import { COVER_COLORS, COVER_PHOTOS, coverColorKey, coverImageSrc } from '@/lib/docs-cover';
import { cleanExternalUrl } from '@/lib/docs-embeds';
import { DocsUploadError, uploadDocsFile } from '@/lib/docs-upload-client';
import { rememberUploadPreview, uploadPreview } from './DocsEditorImage';

/** src de una portada de imagen: lo recién subido se ve desde el archivo local hasta que se guarda. */
export function coverSrc(pageId: string, value: string): string | null {
  if (isDocsUploadUrl(value)) return uploadPreview(value) ?? coverImageSrc(pageId, value);
  return coverImageSrc(pageId, value);
}

/**
 * Portada de la página (como Notion): imagen, color o degradé. Quien edita
 * la cambia, la quita o la reposiciona (arrastrar arriba/abajo, o ↑/↓).
 */
export function DocsCover({
  pageId,
  value,
  position = 50,
  editable,
  onChangeClick,
  onRemove,
  onPosition,
}: {
  pageId: string;
  value: string;
  position?: number;
  editable: boolean;
  onChangeClick?: () => void;
  onRemove?: () => void;
  onPosition?: (pos: number) => void;
}) {
  const t = useTranslations('docs');
  const [repositioning, setRepositioning] = useState(false);
  const [pos, setPos] = useState(position);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setPos(position), [position]);
  const color = coverColorKey(value);
  const src = coverSrc(pageId, value);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!repositioning) return;
    e.preventDefault();
    const h = wrapRef.current?.getBoundingClientRect().height ?? 200;
    const y0 = e.clientY;
    const p0 = pos;
    const move = (ev: PointerEvent) => setPos(Math.max(0, Math.min(100, p0 - ((ev.clientY - y0) / h) * 100)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={wrapRef}
      className={`docs-cover${color ? ` docs-cover-color docs-cover-color-${color}` : ''}${repositioning ? ' is-repositioning' : ''}`}
      data-testid="docs-cover"
      onPointerDown={startDrag}
      tabIndex={repositioning ? 0 : undefined}
      aria-label={repositioning ? t('editor.cover.dragHint') : undefined}
      onKeyDown={(e) => {
        if (!repositioning) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          setPos((p) => Math.max(0, Math.min(100, p + (e.key === 'ArrowUp' ? 5 : -5))));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onPosition?.(Math.round(pos));
          setRepositioning(false);
        } else if (e.key === 'Escape') {
          setPos(position);
          setRepositioning(false);
        }
      }}
    >
      {src && (
        // URL del usuario o de nuestra ruta con permisos: next/image exigiría allowlist de dominios.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="docs-cover-img" style={{ objectPosition: `center ${pos}%` } as CSSProperties} draggable={false} />
      )}
      {repositioning && <span className="docs-cover-hint">{t('editor.cover.dragHint')}</span>}
      {editable && (
        <div className="docs-cover-actions">
          {repositioning ? (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onPosition?.(Math.round(pos));
                  setRepositioning(false);
                }}
              >
                {t('editor.cover.savePosition')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setPos(position);
                  setRepositioning(false);
                }}
              >
                {t('templates.cancel')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onChangeClick}>
                {t('editor.cover.change')}
              </button>
              {src && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setRepositioning(true);
                    requestAnimationFrame(() => wrapRef.current?.focus());
                  }}
                >
                  {t('editor.cover.reposition')}
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-sm docs-cover-remove" onClick={onRemove}>
                {t('editor.removeCover')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Elegir portada: galería (colores y fotos), subir una imagen o pegar un link. */
export default function DocsCoverPicker({
  uploadUrl,
  onPick,
  onClose,
}: {
  uploadUrl: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('docs');
  const [tab, setTab] = useState<'gallery' | 'upload' | 'link'>('gallery');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const upload = async (file: File) => {
    if (!uploadUrl) return;
    if (!file.type.startsWith('image/')) {
      setError(t('editor.cover.notImage'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const up = await uploadDocsFile(file, { uploadUrl });
      rememberUploadPreview(up.url, file);
      onPick(up.url);
    } catch (err) {
      setError(err instanceof DocsUploadError && err.code === 'file_too_large' ? t('editor.cover.tooLarge') : t('editor.cover.uploadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const tabs = (['gallery', ...(uploadUrl ? ['upload'] : []), 'link'] as Array<'gallery' | 'upload' | 'link'>);

  return (
    <div ref={rootRef} className="docs-menu docs-cover-popover" role="dialog" aria-label={t('editor.addCover')} data-testid="docs-cover-picker">
      <div className="docs-cover-tabs" role="tablist">
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`docs-cover-tab${tab === k ? ' active' : ''}`}
            onClick={() => setTab(k)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const i = tabs.indexOf(k);
              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
              setTab(next);
              requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
            }}
          >
            {t(`editor.cover.tabs.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'gallery' && (
        <div className="docs-cover-gallery">
          <p className="docs-cover-section">{t('editor.cover.colors')}</p>
          <div className="docs-cover-presets">
            {COVER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`docs-cover-preset docs-cover-color-${c}`}
                aria-label={t('editor.cover.color', { name: t(`editor.cover.colorNames.${c}`) })}
                title={t(`editor.cover.colorNames.${c}`)}
                onClick={() => onPick(`${COVER_COLOR_PREFIX}${c}`)}
              />
            ))}
          </div>
          <p className="docs-cover-section">{t('editor.cover.photos')}</p>
          <div className="docs-cover-presets">
            {COVER_PHOTOS.map((url, i) => (
              <button
                key={url}
                type="button"
                className="docs-cover-preset"
                style={{ backgroundImage: `url(${url})` }}
                aria-label={t('editor.cover.photo', { n: i + 1 })}
                onClick={() => onPick(url)}
              />
            ))}
          </div>
        </div>
      )}
      {tab === 'upload' && (
        <div className="docs-cover-upload">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? t('editor.cover.uploading') : t('editor.cover.uploadButton')}
          </button>
          <p className="docs-cover-help">{t('editor.cover.uploadHelp')}</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            data-testid="docs-cover-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
        </div>
      )}
      {tab === 'link' && (
        <form
          className="docs-cover-link"
          onSubmit={(e) => {
            e.preventDefault();
            const url = cleanExternalUrl(link.trim());
            if (!url) {
              setError(t('editor.link.invalid'));
              return;
            }
            onPick(url);
          }}
        >
          <input
            type="url"
            className="input docs-cover-input"
            placeholder={t('editor.coverUrlPlaceholder')}
            aria-label={t('editor.coverUrlPlaceholder')}
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!link.trim()}>
            {t('editor.cover.submitLink')}
          </button>
        </form>
      )}
      {error && (
        <p className="docs-cover-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
