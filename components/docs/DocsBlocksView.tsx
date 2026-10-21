import type { ReactNode } from 'react';
import { databaseHeader, type DocsBlock } from '@/lib/docs-types';
import { buildToc } from '@/lib/docs-toc';
import { docsFileHref, formatFileSize } from '@/lib/docs-files';
import { blocksToTree, isToggleBlock, type DocsBlockNode } from '@/lib/docs-blocks';
import { DocsBoardPreview } from './DocsBoardEmbed';

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
}: {
  blocks: DocsBlock[];
  pageId?: string;
  /** URL propia de los archivos (Notes); gana sobre `pageId`. */
  fileHref?: (blockId: string, opts?: { download?: boolean }) => string;
  className?: string;
  /** Vista previa de pizarras embebidas (el centro de ayuda público no las muestra: son internas). */
  boards?: boolean;
}) {
  const hrefFor = fileHref ?? (pageId ? (blockId: string, opts?: { download?: boolean }) => docsFileHref(pageId, blockId, opts) : null);
  const anchors = new Map(buildToc(blocks).map((e) => [e.blockId, e.anchor]));

  /** Un bloque (sin hijos). null si no se muestra (archivo sin URL). */
  const renderBlock = (b: DocsBlock): ReactNode => {
    switch (b.type) {
      case 'heading': {
        const html = { __html: b.content };
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
            <span dangerouslySetInnerHTML={{ __html: b.content }} />
          </p>
        );
      case 'quote':
        return <blockquote key={b.id} dangerouslySetInnerHTML={{ __html: b.content }} />;
      case 'callout':
        return (
          <div key={b.id} className="dbv-callout">
            <span className="dbv-callout-icon" aria-hidden="true">
              {b.icon || '💡'}
            </span>
            <div dangerouslySetInnerHTML={{ __html: b.content }} />
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
          <figure key={b.id} className="dbv-image">
            {/* Servida por nuestra API con chequeo de acceso: next/image no aplica. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hrefFor(b.id)} alt={b.name ?? ''} loading="lazy" />
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
      case 'board':
        // Vista previa con chequeo de acceso de quien mira (sin acceso: aviso, sin datos).
        if (!boards || !b.board_id) return null;
        return <DocsBoardPreview key={b.id} boardId={b.board_id} />;
      case 'table':
      case 'database': {
        const header = databaseHeader(b);
        return (
          <div key={b.id} className="dbv-table">
            <table>
              {header && header.length > 0 && (
                <thead>
                  <tr>
                    {header.map((h, c) => (
                      <th key={c}>{h}</th>
                    ))}
                  </tr>
                </thead>
              )}
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
        return <p key={b.id} dangerouslySetInnerHTML={{ __html: b.content }} />;
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
            <span dangerouslySetInnerHTML={{ __html: it.block.content }} />
            {it.children.length > 0 && renderNodes(it.children)}
          </li>
        ));
        out.push(type === 'numbered_list_item' ? <ol key={b.id}>{children}</ol> : <ul key={b.id}>{children}</ul>);
        continue;
      }
      const node = nodes[i++];
      if (isToggleBlock(b)) {
        const summary =
          b.type === 'heading' ? renderBlock(b) : <span dangerouslySetInnerHTML={{ __html: b.content }} />;
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
