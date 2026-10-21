'use client';

import { forwardRef, useLayoutEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { DocsBlock, DocsBlockType } from '@/lib/docs-types';
import {
  escapeHtml,
  htmlToFlatText,
  insertHtmlAtSelection,
  sanitizeHtml,
  serializeEditable,
} from '@/lib/docs-richtext';
import { isPageLinkId, pageLinkHref, type PageLinkSource } from '@/lib/docs-page-links';
import { formatFileSize, isDocsUploadUrl } from '@/lib/docs-files';
import { htmlToBlocks, shouldSplitPaste } from '@/lib/docs-paste';
import { looksLikeMarkdown, markdownToBlocks, plainTextToBlocks } from '@/lib/docs-import';
import { isToggleBlock } from '@/lib/docs-blocks';
import DocsGlyph from './DocsGlyphs';
import EmojiPicker from './EmojiPicker';
import DocsDatabaseBlock from './DocsDatabaseBlock';

interface DocsBlockEditorProps {
  block: DocsBlock;
  index: number;
  listIndex?: number;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus: (index: number) => void;
  focused: boolean;
  /** URL (con chequeo de acceso) del archivo de un bloque image/file. */
  fileHref?: (blockId: string, opts?: { download?: boolean }) => string;
  /** Links [[ que no son páginas de Docs (Notes): href y cómo abrirlos. */
  pageLinks?: Pick<PageLinkSource, 'href' | 'open'>;
  /** Pegar archivos (captura de pantalla, archivo copiado): los sube el editor. */
  onPasteFiles?: (index: number, files: File[]) => void;
  /** Pegado con estructura (varios párrafos, listas, Markdown): el editor lo parte en bloques. */
  onPasteBlocks?: (index: number, blocks: DocsBlock[]) => void;
}

/** HTML pegado sin estructura semántica (VS Code, terminales): manda el texto plano. */
const SEMANTIC_HTML_RE = /<(h[1-6]|ul|ol|li|blockquote|pre|table|hr)\b/i;

/**
 * Bloques de un pegado, si el contenido tiene estructura; null si es un
 * pegado en línea (un solo párrafo de texto). Todo pasa por el saneado del editor.
 */
function pastedBlocks(html: string, text: string): DocsBlock[] | null {
  const textBlocks = (): DocsBlock[] | null => {
    if (!/\n/.test(text.trim())) return null;
    return looksLikeMarkdown(text) ? markdownToBlocks(text, { sanitize: sanitizeHtml }) : plainTextToBlocks(text.trim());
  };
  if (html && SEMANTIC_HTML_RE.test(html)) {
    const blocks = htmlToBlocks(html, { sanitize: sanitizeHtml });
    return shouldSplitPaste(blocks) ? blocks : null;
  }
  // Markdown copiado de un editor de código o de un chat: viene como texto
  // (o con un HTML de spans sin estructura).
  if (text && looksLikeMarkdown(text)) {
    const blocks = textBlocks();
    if (blocks && shouldSplitPaste(blocks)) return blocks;
  }
  if (html) {
    const blocks = htmlToBlocks(html, { sanitize: sanitizeHtml });
    return shouldSplitPaste(blocks) ? blocks : null;
  }
  const blocks = textBlocks();
  return blocks && shouldSplitPaste(blocks) ? blocks : null;
}

const DocsBlockEditor = forwardRef<HTMLDivElement, DocsBlockEditorProps>(
  ({ block, index, listIndex, onChange, onKeyDown, onFocus, focused, fileHref, pageLinks, onPasteFiles, onPasteBlocks }, ref) => {
    const t = useTranslations('docs');
    const locale = useLocale();
    const router = useRouter();
    const innerRef = useRef<HTMLDivElement | null>(null);
    const linkHref = pageLinks?.href ?? pageLinkHref;

    const renderPlaceholder = (type: DocsBlockType): string => {
      switch (type) {
        case 'heading':
          return t('editor.headingPlaceholder');
        case 'quote':
          return t('editor.quotePlaceholder');
        case 'toggle':
          return t('editor.togglePlaceholder');
        case 'callout':
          return t('editor.calloutPlaceholder');
        case 'code':
          return '// code';
        default:
          return t('editor.placeholder');
      }
    };

    useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      // Sync anti-clobber: solo reescribe el DOM cuando el contenido cambió por
      // fuera del tipeo (split/merge/markdown/formato). Se compara el DOM
      // serializado al subset HTML-lite con el modelo: mientras se escribe ya
      // coincide y no se toca ni el DOM ni el caret.
      // useLayoutEffect: corre antes que el efecto de foco del padre, así el
      // caret/selección pendiente se aplica sobre el DOM ya actualizado.
      if (serializeEditable(el) !== block.content) {
        el.innerHTML = block.content;
      }
      // Un '\n' final no renderiza una línea vacía visible en contentEditable
      // (y el browser arrastra el caret antes del '\n'): se agrega un <br>
      // centinela. El serializador ignora los <br data-sentinel>, así que el
      // modelo sigue limpio.
      const needBr = block.content.endsWith('\n');
      const lastEl = el.lastElementChild;
      const hasBr = lastEl?.tagName === 'BR';
      if (needBr && !hasBr) {
        const br = document.createElement('br');
        br.setAttribute('data-sentinel', '');
        el.appendChild(br);
      } else if (!needBr && hasBr) {
        lastEl.remove();
      }
      // Links a página: atómicos como en Notion (el caret no entra, Backspace
      // los borra enteros) y con el href del locale actual. El serializador
      // ignora estos atributos (rehace el href desde data-page).
      el.querySelectorAll<HTMLAnchorElement>('a[data-page]').forEach((a) => {
        const id = a.getAttribute('data-page') ?? '';
        if (!isPageLinkId(id)) return;
        a.contentEditable = 'false';
        a.href = `/${locale}${linkHref(id)}`;
      });
    }, [block.id, block.content, locale, linkHref]);

    /**
     * Click en un link: el de página navega (Cmd/Ctrl+click: pestaña nueva);
     * un link externo se abre solo con Cmd/Ctrl+click (el click simple edita).
     */
    const onLinkClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const a = (e.target as Element).closest?.('a');
      if (!a || !e.currentTarget.contains(a)) return;
      const page = a.getAttribute('data-page');
      const modifier = e.metaKey || e.ctrlKey;
      if (page !== null && isPageLinkId(page)) {
        e.preventDefault();
        if (modifier) window.open(`/${locale}${linkHref(page)}`, '_blank', 'noopener');
        else if (pageLinks?.open) pageLinks.open(page);
        else router.push(linkHref(page));
        return;
      }
      if (modifier) {
        const href = a.getAttribute('href');
        if (!href) return;
        e.preventDefault();
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    };

    if (block.type === 'divider') {
      return <hr className="docs-divider" data-index={index} />;
    }

    if (block.type === 'image' || block.type === 'file') {
      // Bloque atómico: se enfoca entero (Tab/flechas/click). Enter crea un
      // párrafo abajo y Backspace/Supr lo borra (lo maneja el editor). En el
      // editor la imagen sale de la URL del storage (el bloque recién subido
      // todavía no está guardado); la descarga pasa por la API con permisos.
      const hasFile = isDocsUploadUrl(block.url);
      const name = block.name || t('editor.upload.untitledFile');
      return (
        <div
          ref={(node) => {
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          className={`docs-block docs-file-block docs-file-block-${block.type}${focused ? ' focused' : ''}`}
          data-index={index}
          data-testid={`docs-${block.type}-block`}
          tabIndex={0}
          role="group"
          aria-label={block.type === 'image' ? t('editor.upload.imageLabel', { name }) : t('editor.upload.fileLabel', { name })}
          onKeyDown={(e) => onKeyDown(index, e)}
          onFocus={(e) => {
            if (e.target === e.currentTarget) onFocus(index);
          }}
        >
          {!hasFile ? (
            <span className="docs-file-missing">{t('editor.upload.missing')}</span>
          ) : block.type === 'image' ? (
            // URL del storage propio (blob o /uploads): next/image exigiría allowlist.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="docs-image" src={block.url} alt={name} draggable={false} />
          ) : (
            <a
              className="docs-file-card"
              href={fileHref ? fileHref(block.id, { download: true }) : block.url}
              download={name}
              tabIndex={-1}
            >
              <span className="docs-file-icon" aria-hidden="true">
                <DocsGlyph name="file" size={18} />
              </span>
              <span className="docs-file-name">{name}</span>
              <span className="docs-file-size">{formatFileSize(block.size)}</span>
            </a>
          )}
        </div>
      );
    }

    if (block.type === 'database') {
      return (
        <DocsDatabaseBlock
          block={block}
          index={index}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
        />
      );
    }

    if (block.type === 'table') {
      return (
        <div className="docs-table-wrap" data-index={index}>
          <table className="docs-table">
            <tbody>
              {(block.rows?.length ? block.rows : [['', ''], ['', '']]).map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>
                      <input
                        className="docs-table-cell"
                        value={cell}
                        onChange={(e) => {
                          const rows = block.rows?.length ? block.rows.map((rr) => [...rr]) : [['', ''], ['', '']];
                          rows[r][c] = e.target.value;
                          onChange(index, { rows });
                        }}
                        onKeyDown={(e) => onKeyDown(index, e)}
                        onFocus={() => onFocus(index)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="docs-table-add"
            onClick={() => {
              const rows = block.rows?.length ? block.rows.map((rr) => [...rr]) : [['', ''], ['', '']];
              rows.push(new Array(rows[0]?.length || 2).fill(''));
              onChange(index, { rows });
            }}
          >
            {t('editor.addRow')}
          </button>
        </div>
      );
    }

    const isCheck = block.type === 'todo';
    const isToggle = isToggleBlock(block);
    const isCallout = block.type === 'callout';

    return (
      <div
        className={`docs-block docs-block-${block.type}${isToggle ? ' docs-block-toggleable' : ''}${block.collapsed && isToggle ? ' collapsed' : ''}${focused ? ' focused' : ''}`}
        data-index={index}
      >
        {isToggle && (
          <button
            type="button"
            className="docs-toggle-btn"
            aria-expanded={!block.collapsed}
            aria-label={block.collapsed ? t('editor.expand') : t('editor.collapse')}
            title={block.collapsed ? t('editor.expand') : t('editor.collapse')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(index, { collapsed: !block.collapsed })}
          >
            <DocsGlyph name="toggle" size={14} />
          </button>
        )}
        {isCallout && (
          <EmojiPicker
            value={block.icon ?? '💡'}
            triggerClassName="docs-callout-icon"
            triggerLabel={t('editor.calloutIcon')}
            onChange={(icon) => onChange(index, { icon })}
          >
            <span aria-hidden="true">{block.icon || '💡'}</span>
          </EmojiPicker>
        )}
        {isCheck && (
          <input
            type="checkbox"
            className="docs-check"
            checked={block.checked ?? false}
            onChange={(e) => onChange(index, { checked: e.target.checked })}
          />
        )}
        {block.type === 'code' && (
          <div className="docs-code-lang">
            <input
              className="docs-lang-input"
              value={block.language ?? ''}
              placeholder={t('editor.languagePlaceholder')}
              onChange={(e) => onChange(index, { language: e.target.value })}
            />
          </div>
        )}
        <div
          ref={(node) => {
            innerRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          role={blockRole(block.type, block.level)}
          aria-level={block.type === 'heading' ? block.level ?? 2 : undefined}
          data-index={listIndex}
          // .docs-toggle ya es el interruptor del menú de página: el texto del toggle usa otro nombre.
          className={`docs-editable docs-${block.type === 'toggle' ? 'toggle-text' : block.type}${block.level ? ` docs-h${block.level}` : ''}`}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={renderPlaceholder(block.type)}
          onInput={(e) => onChange(index, { content: serializeEditable(e.currentTarget) })}
          onPaste={(e) => {
            // Paste saneado: solo entra el subset HTML-lite (o texto escapado
            // en bloques de código); nada de spans/estilos/scripts de la web.
            e.preventDefault();
            const el = innerRef.current;
            if (!el) return;
            const cd = e.clipboardData;
            const html = cd.getData('text/html');
            // Archivos sin HTML (captura de pantalla, archivo copiado del
            // Finder/Explorador): se suben como bloques. Con HTML (Word, la
            // web) gana el texto.
            const files = Array.from(cd.files ?? []);
            if (onPasteFiles && files.length > 0 && !html && block.type !== 'code') {
              onPasteFiles(index, files);
              return;
            }
            // Varios párrafos, listas, headings o Markdown: bloques reales.
            if (onPasteBlocks && block.type !== 'code') {
              const blocks = pastedBlocks(html, cd.getData('text/plain'));
              if (blocks) {
                onPasteBlocks(index, blocks);
                return;
              }
            }
            let insert: string;
            if (block.type === 'code') {
              const text = html ? htmlToFlatText(html) : cd.getData('text/plain');
              insert = escapeHtml(text);
            } else if (html) {
              insert = sanitizeHtml(html).replace(/\n+$/g, '');
            } else {
              insert = escapeHtml(cd.getData('text/plain'));
            }
            if (!insert) return;
            insertHtmlAtSelection(el, insert);
            onChange(index, { content: serializeEditable(el) });
          }}
          onKeyDown={(e) => onKeyDown(index, e)}
          onFocus={() => onFocus(index)}
          onClick={onLinkClick}
        />
      </div>
    );
  },
);

DocsBlockEditor.displayName = 'DocsBlockEditor';

export default DocsBlockEditor;

function blockRole(type: DocsBlockType, level?: number): string | undefined {
  if (type === 'heading') {
    if (level === 1) return 'heading';
    if (level === 2) return 'heading';
    if (level === 3) return 'heading';
    return 'heading';
  }
  if (type === 'quote') return 'blockquote';
  return undefined;
}
