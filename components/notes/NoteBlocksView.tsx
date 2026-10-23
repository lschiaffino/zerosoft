import type { CSSProperties, ReactNode } from 'react';
import type { DocsBlock } from '@/lib/docs-types';
import DbReadOnly from '@/components/docs/database/DbReadOnly';
import { formatFileSize } from '@/lib/docs-files';
import { blockIndent } from '@/lib/docs-blocks';

/** Bloques anidados (Tab en el editor): sangría por nivel, en la lista plana. */
function indentStyle(b: DocsBlock): CSSProperties | undefined {
  const d = blockIndent(b);
  return d ? { marginLeft: `${d * 1.5}em` } : undefined;
}

/**
 * Render de solo lectura de los bloques de una nota (link público /n/<token>
 * y notas en la papelera). El contenido ya viene sanitizado por el servidor
 * (lib/docs-sanitize.ts → subset HTML-lite), por eso se puede usar innerHTML.
 * Imágenes y archivos salen de `fileHref` (la ruta de Notes con chequeo de
 * dueño o del token público); sin él no se muestran.
 */
export default function NoteBlocksView({
  blocks,
  fileHref,
}: {
  blocks: DocsBlock[];
  fileHref?: (blockId: string, opts?: { download?: boolean }) => string;
}) {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') {
      const type = b.type;
      const items: DocsBlock[] = [];
      while (i < blocks.length && blocks[i].type === type) items.push(blocks[i++]);
      const children = items.map((it) => (
        <li key={it.id} style={indentStyle(it)} dangerouslySetInnerHTML={{ __html: it.content }} />
      ));
      out.push(type === 'numbered_list_item' ? <ol key={b.id}>{children}</ol> : <ul key={b.id}>{children}</ul>);
      continue;
    }
    i++;
    switch (b.type) {
      case 'heading': {
        const html = { __html: b.content };
        out.push(
          b.level === 1 ? (
            <h2 key={b.id} dangerouslySetInnerHTML={html} />
          ) : b.level === 2 ? (
            <h3 key={b.id} dangerouslySetInnerHTML={html} />
          ) : (
            <h4 key={b.id} dangerouslySetInnerHTML={html} />
          ),
        );
        break;
      }
      case 'todo':
        out.push(
          <p key={b.id} className={`note-view-todo${b.checked ? ' done' : ''}`}>
            <input type="checkbox" checked={Boolean(b.checked)} readOnly disabled aria-hidden />
            <span dangerouslySetInnerHTML={{ __html: b.content }} />
          </p>,
        );
        break;
      case 'quote':
        out.push(<blockquote key={b.id} dangerouslySetInnerHTML={{ __html: b.content }} />);
        break;
      case 'callout':
        out.push(
          <div key={b.id} className="note-view-callout" style={indentStyle(b)}>
            <span aria-hidden="true">{b.icon || '💡'}</span>
            <div dangerouslySetInnerHTML={{ __html: b.content }} />
          </div>,
        );
        break;
      case 'toggle':
        out.push(
          <p key={b.id} className="note-view-toggle" style={indentStyle(b)}>
            <span aria-hidden="true">▸ </span>
            <span dangerouslySetInnerHTML={{ __html: b.content }} />
          </p>,
        );
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
        if (fileHref && b.url !== undefined) {
          out.push(
            <figure key={b.id} className="note-view-image">
              {/* Servida por nuestra API con chequeo de acceso: next/image no aplica. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileHref(b.id)} alt={b.name ?? ''} loading="lazy" />
            </figure>,
          );
        }
        break;
      case 'file':
        if (fileHref && b.url !== undefined) {
          out.push(
            <p key={b.id} className="note-view-file">
              <a href={fileHref(b.id, { download: true })} download={b.name || true}>
                {b.name || 'file'}
              </a>
              <span className="note-view-file-size">{formatFileSize(b.size)}</span>
            </p>,
          );
        }
        break;
      case 'database':
        // La vista activa de la base (link público y papelera; sin personas).
        out.push(<DbReadOnly key={b.id} block={b} className="note-view-table" />);
        break;
      case 'table': {
        out.push(
          <div key={b.id} className="note-view-table">
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
          </div>,
        );
        break;
      }
      default:
        out.push(<p key={b.id} style={indentStyle(b)} dangerouslySetInnerHTML={{ __html: b.content || '&nbsp;' }} />);
    }
  }
  return <div className="note-view">{out}</div>;
}
