import type { ReactNode } from 'react';
import type { DocsBlock } from '@/lib/docs-types';
import { buildToc } from '@/lib/docs-toc';
import { docsFileHref, formatFileSize } from '@/lib/docs-files';
import { blocksToTree, isToggleBlock, type DocsBlockNode } from '@/lib/docs-blocks';
import { DocsBoardPreview } from './DocsBoardEmbed';
import DbReadOnly from './database/DbReadOnly';
import { BookmarkCard, EmbedFrame } from './DocsLinkCards';
import { columnRatio } from '@/lib/docs-columns';
import { renderTex, texFromContent, withInlineMath } from '@/lib/docs-math';
import 'katex/dist/katex.min.css';
import '@/styles/docs-blocks-shared.css';

/**
 * Render de solo lectura de los bloques de una página de Docs: centro de
 * ayuda público (/h), páginas compartidas en modo lectura y la vista previa
 * de versiones. El contenido tiene que venir sanitizado (lib/docs-sanitize.ts
 * en el servidor), por eso se usa innerHTML. Los headings llevan id de ancla
 * para el índice (lib/docs-toc.ts). Los bloques anidados (Tab) se arman en
 * árbol (lib/docs-blocks.ts): listas anidadas, toggles como <details>. Imágenes y archivos se piden a
 * /api/docs/files con `pageId` (sin él, como en un render sin página, no se
 * muestran).
 */
export default function DocsBlocksView({
  blocks,
  pageId,
  fileHref,
  className = '',
  boards = true,
  people,
  locale,
  trail,
}: {
  blocks: DocsBlock[];
  pageId?: string;
  /** URL propia de los archivos (Notes); gana sobre `pageId`. */
  fileHref?: (blockId: string, opts?: { download?: boolean }) => string;
  className?: string;
  /** Vista previa de pizarras embebidas (el centro de ayuda público no las muestra: son internas). */
  boards?: boolean;
  /** Nombres de los miembros (propiedades persona de las bases); sin esto no se muestran. */
  people?: Record<string, string>;
  locale?: string;
  /** Ruta de la página (bloque breadcrumb); sin esto no se muestra. */
  trail?: Array<{ id: string; title: string; href?: string }>;
}) {
  const hrefFor = fileHref ?? (pageId ? (blockId: string, opts?: { download?: boolean }) => docsFileHref(pageId, blockId, opts) : null);
  const toc = buildToc(blocks);
  const anchors = new Map(toc.map((e) => [e.blockId, e.anchor]));
  /** HTML de un bloque con las ecuaciones en línea ya dibujadas (KaTeX en el servidor). */
  const rich = (html: string) => ({ __html: withInlineMath(html) });
  const caption = (b: DocsBlock) => (b.caption ? <figcaption dangerouslySetInnerHTML={rich(b.caption)} /> : null);

  /** Un bloque (sin hijos). null si no se muestra (archivo sin URL). */
  const renderBlock = (b: DocsBlock): ReactNode => {
    switch (b.type) {
      case 'heading': {
        const html = rich(b.content);
        const id = anchors.get(b.id);
        return b.level === 3 ? (
          <h4 key={b.id} id={id} dangerouslySetInnerHTML={html} />
        ) : b.level === 2 ? (
          <h3 key={b.id} id={id} dangerouslySetInnerHTML={html} />
        ) : (
          <h2 key={b.id} id={id} dangerouslySetInnerHTML={html} />
        );
      }
      case 'todo':
        return (
          <p key={b.id} className={`dbv-todo${b.checked ? ' done' : ''}`}>
            <input type="checkbox" checked={Boolean(b.checked)} readOnly disabled aria-hidden />
            <span dangerouslySetInnerHTML={rich(b.content)} />
          </p>
        );
      case 'quote':
        return <blockquote key={b.id} dangerouslySetInnerHTML={rich(b.content)} />;
      case 'callout':
        return (
          <div key={b.id} className="dbv-callout">
            <span className="dbv-callout-icon" aria-hidden="true">
              {b.icon || '💡'}
            </span>
            <div dangerouslySetInnerHTML={rich(b.content)} />
          </div>
        );
      case 'code':
        return (
          <pre key={b.id}>
            <code dangerouslySetInnerHTML={{ __html: b.content }} />
          </pre>
        );
      case 'divider':
        return <hr key={b.id} />;
      case 'image':
        if (!hrefFor || b.url === undefined) return null;
        return (
          <figure key={b.id} className={`dbv-image dbv-align-${b.align ?? 'center'}`}>
            {/* Servida por nuestra API con chequeo de acceso: next/image no aplica. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hrefFor(b.id)} alt={b.name ?? ''} loading="lazy" style={b.width ? { width: `${b.width}%` } : undefined} />
            {caption(b)}
          </figure>
        );
      case 'video':
        if (!hrefFor || b.url === undefined) return null;
        return (
          <figure key={b.id} className="dbv-media">
            <video src={hrefFor(b.id)} controls preload="metadata" style={b.width ? { width: `${b.width}%` } : undefined} />
            {caption(b)}
          </figure>
        );
      case 'audio':
        if (!hrefFor || b.url === undefined) return null;
        return (
          <figure key={b.id} className="dbv-media">
            <audio src={hrefFor(b.id)} controls preload="metadata" />
            {caption(b)}
          </figure>
        );
      case 'pdf':
        if (!hrefFor || b.url === undefined) return null;
        return (
          <figure key={b.id} className="dbv-media dbv-pdf">
            <iframe src={hrefFor(b.id)} title={b.name ?? 'PDF'} loading="lazy" style={b.width ? { width: `${b.width}%` } : undefined} />
            <a href={hrefFor(b.id)} target="_blank" rel="noopener noreferrer">
              {b.name || 'PDF'}
            </a>
            {caption(b)}
          </figure>
        );
      case 'file':
        if (!hrefFor || b.url === undefined) return null;
        return (
          <p key={b.id} className="dbv-file">
            <a href={hrefFor(b.id, { download: true })} download={b.name || true}>
              {b.name || 'file'}
            </a>
            <span className="dbv-file-size">{formatFileSize(b.size)}</span>
          </p>
        );
      case 'bookmark':
        return b.link ? (
          <div key={b.id} className="dbv-bookmark">
            <BookmarkCard link={b.link} />
          </div>
        ) : null;
      case 'embed':
        return b.link ? (
          <div key={b.id} className="dbv-embed">
            <EmbedFrame url={b.link.url} height={b.height} width={b.width} />
          </div>
        ) : null;
      case 'equation': {
        const tex = texFromContent(b.content);
        return tex ? <div key={b.id} className="dbv-equation" dangerouslySetInnerHTML={{ __html: renderTex(tex, true) }} /> : null;
      }
      case 'toc':
        return toc.length ? (
          <nav key={b.id} className="dbv-toc" aria-label="Table of contents">
            <ul>
              {toc.map((e) => (
                <li key={e.blockId} className={`dbv-toc-l${e.level}`}>
                  <a href={`#${e.anchor}`}>{e.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null;
      case 'breadcrumb':
        return trail?.length ? (
          <nav key={b.id} className="dbv-breadcrumb" aria-label="Breadcrumb">
            <ol>
              {trail.map((p) => (
                <li key={p.id}>{p.href ? <a href={p.href}>{p.title}</a> : <span>{p.title}</span>}</li>
              ))}
            </ol>
          </nav>
        ) : null;
      case 'button':
        // En lectura el botón no hace nada salvo abrir su link.
        return b.button?.action === 'link' && b.button.url ? (
          <p key={b.id} className="dbv-button">
            <a className="btn btn-secondary btn-sm" href={b.button.url} target={b.button.url.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer">
              {b.button.label || b.button.url}
            </a>
          </p>
        ) : null;
      case 'columns':
      case 'column':
      case 'synced':
        return null;
      case 'board':
        // Vista previa con chequeo de acceso de quien mira (sin acceso: aviso, sin datos).
        if (!boards || !b.board_id) return null;
        return <DocsBoardPreview key={b.id} boardId={b.board_id} />;
      case 'database':
        // La vista activa de la base (filtro, orden, agrupado), en lectura.
        return <DbReadOnly key={b.id} block={b} people={people} locale={locale} />;
      case 'table': {
        return (
          <div key={b.id} className="dbv-table">
            <table>
              <tbody>
                {(b.rows ?? []).map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default:
        if (!b.content) return <p key={b.id} className="dbv-empty" aria-hidden />;
        return <p key={b.id} dangerouslySetInnerHTML={rich(b.content)} />;
    }
  };

  /**
   * Hermanos de un nivel: los ítems de lista seguidos van en un <ul>/<ol>
   * con sus hijos adentro del <li>; los toggles son <details> (abiertos si
   * no están plegados) y el resto de los bloques con hijos los anidan debajo.
   */
  const renderNodes = (nodes: DocsBlockNode[]): ReactNode[] => {
    const out: ReactNode[] = [];
    let i = 0;
    while (i < nodes.length) {
      const b = nodes[i].block;
      if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') {
        const type = b.type;
        const items: DocsBlockNode[] = [];
        while (i < nodes.length && nodes[i].block.type === type) items.push(nodes[i++]);
        const children = items.map((it) => (
          <li key={it.block.id}>
            <span dangerouslySetInnerHTML={rich(it.block.content)} />
            {it.children.length > 0 && renderNodes(it.children)}
          </li>
        ));
        out.push(type === 'numbered_list_item' ? <ol key={b.id}>{children}</ol> : <ul key={b.id}>{children}</ul>);
        continue;
      }
      const node = nodes[i++];
      // Columnas: una fila con cada columna al lado (se apilan en el teléfono).
      if (b.type === 'columns') {
        const cols = node.children.filter((c) => c.block.type === 'column');
        out.push(
          <div key={b.id} className="dbv-columns">
            {cols.map((c) => (
              <div key={c.block.id} className="dbv-column" style={{ flexGrow: columnRatio(c.block) }}>
                {renderNodes(c.children)}
              </div>
            ))}
          </div>,
        );
        continue;
      }
      // Sincronizado: en lectura es su contenido, sin marco.
      if (b.type === 'synced') {
        out.push(<div key={b.id} className="dbv-synced">{renderNodes(node.children)}</div>);
        continue;
      }
      if (isToggleBlock(b)) {
        const summary =
          b.type === 'heading' ? renderBlock(b) : <span dangerouslySetInnerHTML={rich(b.content)} />;
        out.push(
          <details key={b.id} className={`dbv-toggle${b.type === 'heading' ? ' dbv-toggle-heading' : ''}`} open={!b.collapsed}>
            <summary>{summary}</summary>
            {node.children.length > 0 && <div className="dbv-children">{renderNodes(node.children)}</div>}
          </details>,
        );
        continue;
      }
      const own = renderBlock(b);
      if (own) out.push(own);
      if (node.children.length > 0) {
        out.push(
          <div key={`${b.id}-children`} className="dbv-children">
            {renderNodes(node.children)}
          </div>,
        );
      }
    }
    return out;
  };

  const out = renderNodes(blocksToTree(blocks));
  return <div className={`dbv${className ? ` ${className}` : ''}`}>{out}</div>;
}
