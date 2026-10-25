'use client';

import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsBlock } from '@/lib/docs-types';
import { formatFileSize, isDocsUploadUrl } from '@/lib/docs-files';
import { sanitizeHtml, serializeEditable } from '@/lib/docs-richtext';
import DocsGlyph from './DocsGlyphs';
import DocsEditorImage, { uploadPreview } from './DocsEditorImage';

interface Props {
  block: DocsBlock;
  index: number;
  focused: boolean;
  fileHref?: (blockId: string, opts?: { download?: boolean }) => string;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus: (index: number) => void;
}

const SIZED = new Set(['image', 'video', 'pdf']);

/**
 * Imagen, video, audio, PDF o archivo del editor (como en Notion): imagen con
 * asas para cambiar el ancho, alineación y leyenda; video y audio con su
 * reproductor; PDF embebido con su visor. Todo se pide a la ruta con permisos
 * (/api/docs/files o la de Notes). Bloque atómico: se enfoca entero.
 */
const DocsMediaBlock = forwardRef<HTMLDivElement, Props>(({ block, index, focused, fileHref, onChange, onKeyDown, onFocus }, ref) => {
  const t = useTranslations('docs');
  const hasFile = isDocsUploadUrl(block.url) || block.url === '';
  const name = block.name || t('editor.upload.untitledFile');
  const href = fileHref ? fileHref(block.id) : block.url ?? '';
  const download = fileHref ? fileHref(block.id, { download: true }) : block.url ?? '';
  const local = uploadPreview(block.url);
  const src = local ?? href;
  const [captionOpen, setCaptionOpen] = useState(Boolean(block.caption));
  /** Pedido de foco a la leyenda (se aplica después de montarla). */
  const [focusCaption, setFocusCaption] = useState(0);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? block.width ?? (block.type === 'image' ? undefined : 100);
  const align = block.align ?? 'center';

  useLayoutEffect(() => {
    const el = captionRef.current;
    if (el && serializeEditable(el) !== (block.caption ?? '')) el.innerHTML = sanitizeHtml(block.caption ?? '');
  }, [block.caption, captionOpen]);

  useEffect(() => {
    if (!focusCaption) return;
    const el = captionRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [focusCaption]);

  /** Asa izquierda (-1) o derecha (+1): el ancho en % del ancho disponible. */
  const startResize = (e: React.PointerEvent<HTMLButtonElement>, side: -1 | 1) => {
    e.preventDefault();
    e.stopPropagation();
    const frame = frameRef.current;
    const host = frame?.parentElement;
    if (!frame || !host) return;
    const startX = e.clientX;
    const startW = frame.getBoundingClientRect().width;
    const total = host.getBoundingClientRect().width || 1;
    const factor = align === 'center' ? 2 : 1;
    let last = block.width ?? 100;
    const move = (ev: PointerEvent) => {
      const w = startW + (ev.clientX - startX) * side * factor;
      last = Math.max(10, Math.min(100, Math.round((w / total) * 100)));
      setDragWidth(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragWidth(null);
      onChange(index, { width: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Teclado en el asa: ←/→ achica o agranda de a 5%. */
  const resizeKey = (e: React.KeyboardEvent<HTMLButtonElement>, side: -1 | 1) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const dir = (e.key === 'ArrowRight' ? 1 : -1) * side;
    onChange(index, { width: Math.max(10, Math.min(100, (block.width ?? 100) + dir * 5)) });
  };

  const media = (() => {
    if (!hasFile) return <span className="docs-file-missing">{t('editor.upload.missing')}</span>;
    switch (block.type) {
      case 'image':
        return <DocsEditorImage storageUrl={block.url ?? ''} href={href} alt={name} />;
      case 'video':
        return <video className="docs-video" src={src} controls preload="metadata" aria-label={t('editor.media.videoLabel', { name })} />;
      case 'audio':
        return (
          <div className="docs-audio">
            <span className="docs-audio-name">{name}</span>
            <audio src={src} controls preload="metadata" aria-label={t('editor.media.audioLabel', { name })} />
          </div>
        );
      case 'pdf':
        return (
          <div className="docs-pdf">
            <iframe className="docs-pdf-frame" src={src} title={t('editor.media.pdfLabel', { name })} loading="lazy" />
            <a className="docs-pdf-open" href={href} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
              {t('editor.media.openPdf', { name })}
            </a>
          </div>
        );
      default:
        return (
          <a className="docs-file-card" href={download} download={name} tabIndex={-1}>
            <span className="docs-file-icon" aria-hidden="true">
              <DocsGlyph name="file" size={18} />
            </span>
            <span className="docs-file-name">{name}</span>
            <span className="docs-file-size">{formatFileSize(block.size)}</span>
          </a>
        );
    }
  })();

  const sized = SIZED.has(block.type) && hasFile;
  const label =
    block.type === 'image'
      ? t('editor.upload.imageLabel', { name })
      : block.type === 'file'
        ? t('editor.upload.fileLabel', { name })
        : t(`editor.media.${block.type}Label`, { name });

  return (
    <div
      ref={ref}
      className={`docs-block docs-file-block docs-file-block-${block.type} docs-media-align-${align}${focused ? ' focused' : ''}`}
      data-index={index}
      data-testid={`docs-${block.type}-block`}
      tabIndex={0}
      role="group"
      aria-label={label}
      onKeyDown={(e) => onKeyDown(index, e)}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocus(index);
      }}
    >
      <div
        ref={frameRef}
        className={`docs-media-frame${sized ? ' is-sized' : ''}`}
        style={sized && width ? ({ width: `${width}%` } as CSSProperties) : undefined}
      >
        {media}
        {sized && (
          <>
            <button
              type="button"
              className="docs-media-handle docs-media-handle-left"
              aria-label={t('editor.media.resize')}
              title={t('editor.media.resize')}
              onPointerDown={(e) => startResize(e, -1)}
              onKeyDown={(e) => resizeKey(e, -1)}
            />
            <button
              type="button"
              className="docs-media-handle docs-media-handle-right"
              aria-label={t('editor.media.resize')}
              title={t('editor.media.resize')}
              onPointerDown={(e) => startResize(e, 1)}
              onKeyDown={(e) => resizeKey(e, 1)}
            />
          </>
        )}
        {hasFile && (
          <div className="docs-media-toolbar" role="toolbar" aria-label={t('editor.media.toolbar')}>
            {block.type === 'image' &&
              (['left', 'center', 'right'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`docs-media-tool${align === a ? ' active' : ''}`}
                  aria-pressed={align === a}
                  aria-label={t(`editor.media.align.${a}`)}
                  title={t(`editor.media.align.${a}`)}
                  onClick={() => onChange(index, { align: a })}
                >
                  <DocsGlyph name={a === 'left' ? 'alignLeft' : a === 'center' ? 'alignCenter' : 'alignRight'} size={14} />
                </button>
              ))}
            <button
              type="button"
              className={`docs-media-tool${captionOpen ? ' active' : ''}`}
              aria-pressed={captionOpen}
              aria-label={t('editor.media.caption')}
              title={t('editor.media.caption')}
              onClick={() => {
                setCaptionOpen(true);
                setFocusCaption((n) => n + 1);
              }}
            >
              <DocsGlyph name="caption" size={14} />
            </button>
            <a
              className="docs-media-tool"
              href={download}
              download={name}
              aria-label={t('editor.media.download')}
              title={t('editor.media.download')}
            >
              <DocsGlyph name="down" size={14} />
            </a>
          </div>
        )}
      </div>
      {captionOpen && (
        <div
          ref={captionRef}
          className="docs-media-caption docs-editable"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={t('editor.media.caption')}
          data-placeholder={t('editor.media.captionPlaceholder')}
          onInput={(e) => onChange(index, { caption: serializeEditable(e.currentTarget) })}
          onKeyDown={(e) => {
            // La leyenda tiene su propio teclado: no borra ni parte el bloque.
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              if (!serializeEditable(e.currentTarget)) setCaptionOpen(false);
              (e.currentTarget.closest('.docs-file-block') as HTMLElement | null)?.focus();
            }
          }}
          onBlur={(e) => {
            if (!serializeEditable(e.currentTarget)) setCaptionOpen(false);
          }}
        />
      )}
    </div>
  );
});

DocsMediaBlock.displayName = 'DocsMediaBlock';

export default DocsMediaBlock;
