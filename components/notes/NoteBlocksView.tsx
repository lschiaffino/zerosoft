import type { ReactNode } from 'react';
import type { DocsBlock } from '@/lib/docs-types';

/**
 * Render de solo lectura de los bloques de una nota (link público /n/<token>
 * y notas en la papelera). El contenido ya viene sanitizado por el servidor
 * (lib/docs-sanitize.ts → subset HTML-lite), por eso se puede usar innerHTML.
 */
export default function NoteBlocksView({ blocks }: { blocks: DocsBlock[] }) {
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
      case 'table':
      case 'database':
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
      default:
        out.push(<p key={b.id} dangerouslySetInnerHTML={{ __html: b.content || '&nbsp;' }} />);
    }
  }
  return <div className="note-view">{out}</div>;
}
