'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsBlock, DocsLinkPreview } from '@/lib/docs-types';
import { cleanExternalUrl, embedFor, linkSite } from '@/lib/docs-embeds';
import DocsGlyph from './DocsGlyphs';
import { BookmarkCard, EmbedFrame } from './DocsLinkCards';

export { BookmarkCard, EmbedFrame } from './DocsLinkCards';
import '@/styles/docs-blocks-shared.css';

interface Props {
  block: DocsBlock;
  index: number;
  focused: boolean;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus: (index: number) => void;
  /** Solo lectura (vista publicada, versiones): sin input ni asas. */
  readOnly?: boolean;
}

/** Metadatos del link desde el servidor (safeFetch); si falla, solo la URL. */
export async function fetchLinkPreview(url: string): Promise<DocsLinkPreview> {
  const res = await fetch('/api/docs/unfurl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }).catch(() => null);
  if (!res?.ok) return { url, site: linkSite(url) };
  const data = (await res.json().catch(() => null)) as { preview?: DocsLinkPreview } | null;
  return data?.preview ?? { url, site: linkSite(url) };
}

/**
 * Bloques bookmark y embed. Sin link muestran el campo para pegarlo; el
 * bookmark trae título, descripción e imagen del servidor; el embed arma el
 * iframe del proveedor (YouTube, Figma, Loom, Maps…) y se puede estirar.
 */
const DocsLinkBlock = forwardRef<HTMLDivElement, Props>(({ block, index, focused, onChange, onKeyDown, onFocus, readOnly }, ref) => {
  const t = useTranslations('docs');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const isEmbed = block.type === 'embed';

  useEffect(() => {
    if (focused && !block.link) inputRef.current?.focus();
  }, [focused, block.link]);

  const submit = async () => {
    const url = cleanExternalUrl(value.trim().match(/^https?:\/\//i) ? value.trim() : `https://${value.trim()}`);
    if (!url) {
      setError(t('editor.link.invalid'));
      return;
    }
    if (isEmbed && !embedFor(url)) {
      setError(t('editor.embed.unsupported'));
      return;
    }
    setError(null);
    setLoading(true);
    const preview = await fetchLinkPreview(url);
    setLoading(false);
    onChange(index, { link: preview });
  };

  const startResize = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const frame = (e.currentTarget.parentElement?.querySelector('iframe') as HTMLIFrameElement | null) ?? null;
    if (!frame) return;
    const startY = e.clientY;
    const startH = frame.getBoundingClientRect().height;
    let last = Math.round(startH);
    const move = (ev: PointerEvent) => {
      last = Math.max(120, Math.min(2000, Math.round(startH + ev.clientY - startY)));
      setDragHeight(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragHeight(null);
      onChange(index, { height: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const body = (() => {
    if (!block.link) {
      if (readOnly) return null;
      return (
        <form
          className="docs-link-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DocsGlyph name={isEmbed ? 'embed' : 'bookmark'} size={16} />
          <input
            ref={inputRef}
            className="input docs-link-url-input"
            type="url"
            inputMode="url"
            value={value}
            placeholder={isEmbed ? t('editor.embed.placeholder') : t('editor.link.placeholder')}
            aria-label={isEmbed ? t('editor.embed.placeholder') : t('editor.link.placeholder')}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') (e.currentTarget.closest('.docs-link-block') as HTMLElement | null)?.focus();
            }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!value.trim() || loading}>
            {loading ? t('editor.link.loading') : isEmbed ? t('editor.embed.submit') : t('editor.link.submit')}
          </button>
          {error && (
            <span className="docs-link-error" role="alert">
              {error}
            </span>
          )}
        </form>
      );
    }
    if (!isEmbed) return <BookmarkCard link={block.link} />;
    const info = embedFor(block.link.url);
    if (!info) {
      return (
        <div className="docs-embed-fallback">
          <span>{t('editor.embed.unsupported')}</span>
          {!readOnly && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange(index, { type: 'bookmark' })}>
              {t('editor.embed.asBookmark')}
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="docs-embed">
        <EmbedFrame url={block.link.url} height={dragHeight ?? block.height} width={block.width} />
        {!readOnly && (
          <button
            type="button"
            className="docs-embed-resize"
            aria-label={t('editor.embed.resize')}
            title={t('editor.embed.resize')}
            onPointerDown={startResize}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              e.preventDefault();
              e.stopPropagation();
              const base = block.height ?? info.height;
              onChange(index, { height: Math.max(120, Math.min(2000, base + (e.key === 'ArrowDown' ? 40 : -40))) });
            }}
          />
        )}
        <a className="docs-embed-source" href={block.link.url} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
          {info.label} · {linkSite(block.link.url)}
        </a>
      </div>
    );
  })();

  return (
    <div
      ref={ref}
      className={`docs-block docs-link-block docs-${block.type}-block${focused ? ' focused' : ''}`}
      data-index={index}
      data-testid={`docs-${block.type}-block`}
      tabIndex={0}
      role="group"
      aria-label={isEmbed ? t('editor.embed.label') : t('editor.link.label')}
      onKeyDown={(e) => onKeyDown(index, e)}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocus(index);
      }}
    >
      {body}
    </div>
  );
});

DocsLinkBlock.displayName = 'DocsLinkBlock';

export default DocsLinkBlock;
