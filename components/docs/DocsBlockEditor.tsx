'use client';

import { forwardRef, useLayoutEffect, useMemo, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { DocsBlock, DocsBlockType, DocsButtonConfig } from '@/lib/docs-types';
import type { TocEntry } from '@/lib/docs-toc';
import {
  escapeHtml,
  htmlToFlatText,
  insertHtmlAtSelection,
  sanitizeHtml,
  serializeEditable,
} from '@/lib/docs-richtext';
import { isPageLinkId, pageLinkHref, type PageLinkSource } from '@/lib/docs-page-links';
import { isFileBlockType } from '@/lib/docs-files';
import { htmlToBlocks, shouldSplitPaste } from '@/lib/docs-paste';
import { looksLikeMarkdown, markdownToBlocks, plainTextToBlocks } from '@/lib/docs-import';
import { isToggleBlock } from '@/lib/docs-blocks';
import { pastedUrl } from '@/lib/docs-embeds';
import DocsGlyph from './DocsGlyphs';
import EmojiPicker from './EmojiPicker';
import DocsDatabaseBlock, { type DbHooks } from './DocsDatabaseBlock';
import { DocsBoardPicker, DocsBoardPreview } from './DocsBoardEmbed';
import DocsMediaBlock from './DocsMediaBlock';
import DocsLinkBlock from './DocsLinkBlocks';
import { BreadcrumbBlock, ButtonBlock, EquationBlock, TocBlock } from './DocsAdvancedBlocks';
import { renderInlineTex } from './inlineTex';
import DocsMeetingBlock from './DocsMeetingBlock';

interface DocsBlockEditorProps {
  /** Solo lectura (página bloqueada o permiso de comentar): se selecciona para comentar, no se escribe. */
  readOnly?: boolean;
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
  pageLinks?: Pick<PageLinkSource, 'href' | 'open' | 'rows'>;
  /** Pegar archivos (captura de pantalla, archivo copiado): los sube el editor. */
  onPasteFiles?: (index: number, files: File[]) => void;
  /** Pegado con estructura (varios párrafos, listas, Markdown): el editor lo parte en bloques. */
  onPasteBlocks?: (index: number, blocks: DocsBlock[]) => void;
  /** Bases de datos: abrir una fila como página, miembros (persona), página abierta y bases vecinas. */
  database?: DbHooks;
  /** Títulos de la página (bloque índice). */
  toc?: TocEntry[];
  /** Ruta de la página (bloque breadcrumb). */
  trail?: Array<{ id: string; title: string; icon: string | null }>;
  /** Clic en un bloque botón. */
  onRunButton?: (index: number, button: DocsButtonConfig) => void;
  /** Clic en una ecuación en línea: offset plano donde empieza y su LaTeX. */
  onInlineEquation?: (index: number, start: number, tex: string) => void;
  /** Se pegó un link solo (queda como link; el editor ofrece bookmark o embed). */
  onPasteUrl?: (index: number, url: string) => void;
  /** Se pegó un bloque sincronizado ("Copiar y sincronizar" en otra página). */
  onPasteSynced?: (index: number, syncedId: string) => void;
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
  ({ readOnly = false, block, index, listIndex, onChange, onKeyDown, onFocus, focused, fileHref, pageLinks, onPasteFiles, onPasteBlocks, database, toc, trail, onRunButton, onInlineEquation, onPasteUrl, onPasteSynced }, ref) => {
    const t = useTranslations('docs');
    const locale = useLocale();
    const router = useRouter();
    const innerRef = useRef<HTMLDivElement | null>(null);
    const linkHref = pageLinks?.href ?? pageLinkHref;
    // Primer render con el contenido ya en el HTML (también en el servidor):
    // antes el bloque llegaba vacío y crecía al hidratar (CLS). El valor queda
    // fijo mientras se tipea para que React no reescriba innerHTML (movería el
    // caret); los cambios los sincroniza el efecto de abajo. Se renueva solo si
    // cambia el tipo, por si el nodo editable se vuelve a montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const initialHtml = useMemo(() => ({ __html: block.content }), [block.id, block.type]);

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
        const row = a.getAttribute('data-row');
        a.href = `/${locale}${row && (!pageLinks || pageLinks.rows) ? pageLinkHref(id, row) : linkHref(id)}`;
      });
      // Menciones de fecha y ecuaciones en línea: atómicas como los links a
      // página. La ecuación se dibuja en un shadow root (el texto del span
      // sigue siendo el LaTeX: los offsets del modelo no cambian).
      el.querySelectorAll<HTMLElement>('span[data-date]').forEach((span) => {
        span.contentEditable = 'false';
        span.classList.add('docs-date-mention');
        span.classList.toggle('has-reminder', span.hasAttribute('data-remind'));
      });
      el.querySelectorAll<HTMLElement>('span[data-tex]').forEach((span) => {
        span.contentEditable = 'false';
        span.classList.add('docs-inline-eq');
        renderInlineTex(span, span.getAttribute('data-tex') ?? '');
      });
    }, [block.id, block.content, locale, linkHref, pageLinks]);

    /**
     * Click en un link: el de página navega (Cmd/Ctrl+click: pestaña nueva);
     * un link externo se abre solo con Cmd/Ctrl+click (el click simple edita).
     */
    const onLinkClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const eq = (e.target as Element).closest?.('span[data-tex]');
      if (eq && e.currentTarget.contains(eq) && onInlineEquation) {
        e.preventDefault();
        // Offset plano del span: el texto que hay antes adentro del bloque.
        const range = document.createRange();
        range.setStart(e.currentTarget, 0);
        range.setEndBefore(eq);
        onInlineEquation(index, range.toString().length, eq.getAttribute('data-tex') ?? '');
        return;
      }
      const a = (e.target as Element).closest?.('a');
      if (!a || !e.currentTarget.contains(a)) return;
      const page = a.getAttribute('data-page');
      const modifier = e.metaKey || e.ctrlKey;
      if (page !== null && isPageLinkId(page)) {
        e.preventDefault();
        // Link a una fila de una base (solo Docs): abre la fila como página.
        const row = pageLinks && !pageLinks.rows ? null : a.getAttribute('data-row');
        const href = row ? pageLinkHref(page, row) : linkHref(page);
        if (modifier) window.open(`/${locale}${href}`, '_blank', 'noopener');
        else if (pageLinks?.open) pageLinks.open(page);
        else router.push(href);
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

    const setCardRef = (node: HTMLDivElement | null) => {
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    };

    if (isFileBlockType(block.type)) {
      // Bloque atómico: se enfoca entero (Tab/flechas/click). Enter crea un
      // párrafo abajo y Backspace/Supr lo borra (lo maneja el editor). Todo
      // pasa por la ruta con permisos (lo recién subido se ve desde el
      // archivo local hasta que la página se guarda).
      return (
        <DocsMediaBlock
          ref={setCardRef}
          block={block}
          index={index}
          focused={focused}
          fileHref={fileHref}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
        />
      );
    }

    if (block.type === 'bookmark' || block.type === 'embed') {
      return <DocsLinkBlock ref={setCardRef} block={block} index={index} focused={focused} onChange={onChange} onKeyDown={onKeyDown} onFocus={onFocus} />;
    }

    if (block.type === 'equation') {
      return <EquationBlock ref={setCardRef} block={block} index={index} focused={focused} onChange={onChange} onKeyDown={onKeyDown} onFocus={onFocus} />;
    }

    if (block.type === 'toc') {
      return <TocBlock ref={setCardRef} block={block} index={index} focused={focused} onChange={onChange} onKeyDown={onKeyDown} onFocus={onFocus} toc={toc ?? []} />;
    }

    if (block.type === 'meeting') {
      return (
        <DocsMeetingBlock
          ref={setCardRef}
          block={block}
          index={index}
          focused={focused}
          pageId={database?.pageId ?? null}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
        />
      );
    }

    if (block.type === 'breadcrumb') {
      return <BreadcrumbBlock ref={setCardRef} block={block} index={index} focused={focused} onChange={onChange} onKeyDown={onKeyDown} onFocus={onFocus} trail={trail ?? []} />;
    }

    if (block.type === 'button') {
      return (
        <ButtonBlock
          ref={setCardRef}
          block={block}
          index={index}
          focused={focused}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onRun={(i, b) => onRunButton?.(i, b)}
        />
      );
    }

    // Columnas y bloques sincronizados son contenedores: los dibuja el editor.
    if (block.type === 'columns' || block.type === 'column' || block.type === 'synced') return null;

    if (block.type === 'board') {
      // Pizarra embebida: bloque atómico como imagen/archivo. Sin pizarra
      // elegida muestra el buscador; con pizarra, la vista previa en vivo.
      return (
        <div
          ref={(node) => {
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          className={`docs-block docs-board-block${focused ? ' focused' : ''}`}
          data-index={index}
          data-testid="docs-board-block"
          tabIndex={0}
          role="group"
          aria-label={t('editor.board.label')}
          onKeyDown={(e) => onKeyDown(index, e)}
          onFocus={(e) => {
            if (e.target === e.currentTarget) onFocus(index);
          }}
        >
          {block.board_id ? (
            <DocsBoardPreview boardId={block.board_id} onChange={() => onChange(index, { board_id: undefined })} />
          ) : (
            <DocsBoardPicker autoFocus={focused} onPick={(id) => onChange(index, { board_id: id })} />
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
          onFocus={onFocus}
          hooks={database}
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
          contentEditable={!readOnly}
          suppressContentEditableWarning
          dangerouslySetInnerHTML={initialHtml}
          data-placeholder={readOnly ? undefined : renderPlaceholder(block.type)}
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
            const plain = cd.getData('text/plain');
            // Bloque sincronizado copiado en otra página.
            const synced = plain.trim().match(/^zerosoft-synced:([A-Za-z0-9_-]{8,64})$/);
            if (synced && onPasteSynced && block.type !== 'code') {
              onPasteSynced(index, synced[1]);
              return;
            }
            // Un link solo: entra como link y el editor ofrece mención, bookmark o embed.
            const url = block.type !== 'code' ? pastedUrl(plain) : null;
            if (url && onPasteUrl) {
              insertHtmlAtSelection(el, `<a href="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${escapeHtml(url)}</a>`);
              onChange(index, { content: serializeEditable(el) });
              onPasteUrl(index, url);
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
