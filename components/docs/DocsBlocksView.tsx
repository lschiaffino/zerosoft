import type { ReactNode } from 'react';
import { databaseHeader, type DocsBlock } from '@/lib/docs-types';
import { buildToc } from '@/lib/docs-toc';
import { docsFileHref, formatFileSize } from '@/lib/docs-files';
import { DocsBoardPreview } from './DocsBoardEmbed';

/**
 * Render de solo lectura de los bloques de una página de Docs: centro de
 * ayuda público (/h), páginas compartidas en modo lectura y la vista previa
 * de versiones. El contenido tiene que venir sanitizado (lib/docs-sanitize.ts
 * en el servidor), por eso se usa innerHTML. Los headings llevan id de ancla
 * para el índice (lib/docs-toc.ts). Imágenes y archivos se piden a
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
  const out: ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') {
      const type = b.type;
      const items: DocsBlock[] = [];
      while (i < blocks.length && blocks[i].type === type) items.push(blocks[i++]);
      const children = items.map((it) => <li key={it.id} dangerouslySetInnerHTML={{ __html: it.content }} />);
      out.push(type === 'numbered_list_item' ? <ol key={b.id}>{children}</ol> : <ul key={b.id}>{children}</ul>);
      continue;
    }
    i++;
    switch (b.type) {
      case 'heading': {
        const html = { __html: b.content };
        const id = anchors.get(b.id);
        out.push(
          b.level === 3 ? (
            <h4 key={b.id} id={id} dangerouslySetInnerHTML={html} />
          ) : b.level === 2 ? (
            <h3 key={b.id} id={id} dangerouslySetInnerHTML={html} />
          ) : (
            <h2 key={b.id} id={id} dangerouslySetInnerHTML={html} />
          ),
        );
        break;
      }
      case 'todo':
        out.push(
          <p key={b.id} className={`dbv-todo${b.checked ? ' done' : ''}`}>
            <input type="checkbox" checked={Boolean(b.checked)} readOnly disabled aria-hidden />
            <span dangerouslySetInnerHTML={{ __html: b.content }} />
          </p>,
        );
        break;
      case 'quote':
        out.push(<blockquote key={b.id} dangerouslySetInnerHTML={{ __html: b.content }} />);
        break;
      case 'code':
        out.push(
          <pre key={b.id}>
            <code dangerouslySetInnerHTML={{ __html: b.content }} />
          </pre>,
        );
        break;
      case 'divider':
        out.push(<hr key={b.id} />);
        break;
      case 'image':
        if (hrefFor && b.url !== undefined) {
          out.push(
            <figure key={b.id} className="dbv-image">
              {/* Servida por nuestra API con chequeo de acceso: next/image no aplica. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={hrefFor(b.id)} alt={b.name ?? ''} loading="lazy" />
            </figure>,
          );
        }
        break;
      case 'file':
        if (hrefFor && b.url !== undefined) {
          out.push(
            <p key={b.id} className="dbv-file">
              <a href={hrefFor(b.id, { download: true })} download={b.name || true}>
                {b.name || 'file'}
              </a>
              <span className="dbv-file-size">{formatFileSize(b.size)}</span>
            </p>,
          );
        }
        break;
      case 'board':
        // Vista previa con chequeo de acceso de quien mira (sin acceso: aviso, sin datos).
        if (boards && b.board_id) out.push(<DocsBoardPreview key={b.id} boardId={b.board_id} />);
        break;
      case 'table':
      case 'database': {
        const header = databaseHeader(b);
        out.push(
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
          </div>,
        );
        break;
      }
      default:
        if (!b.content) out.push(<p key={b.id} className="dbv-empty" aria-hidden />);
        else out.push(<p key={b.id} dangerouslySetInnerHTML={{ __html: b.content }} />);
    }
  }
  return <div className={`dbv${className ? ` ${className}` : ''}`}>{out}</div>;
}
