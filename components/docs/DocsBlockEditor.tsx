'use client';

import { forwardRef, useEffect, useRef } from 'react';
import type { DocsBlock, DocsBlockType } from '@/lib/docs-types';

interface DocsBlockEditorProps {
  block: DocsBlock;
  index: number;
  listIndex?: number;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus: (index: number) => void;
  focused: boolean;
}

function renderPlaceholder(type: DocsBlockType): string {
  switch (type) {
    case 'heading':
      return 'Heading';
    case 'quote':
      return 'Empty quote';
    case 'code':
      return "// code";
    default:
      return "Type '/' for commands";
  }
}

const DocsBlockEditor = forwardRef<HTMLDivElement, DocsBlockEditorProps>(
  ({ block, index, listIndex, onChange, onKeyDown, onFocus, focused }, ref) => {
    const innerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const el = innerRef.current;
      if (el && el.textContent !== block.content) {
        el.textContent = block.content;
      }
    }, [block.id]);

    if (block.type === 'divider') {
      return <hr className="docs-divider" data-index={index} />;
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
            + row
          </button>
        </div>
      );
    }

    const isCheck = block.type === 'todo';

    return (
      <div className={`docs-block docs-block-${block.type}${focused ? ' focused' : ''}`} data-index={index}>
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
              placeholder="language"
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
          className={`docs-editable docs-${block.type}${block.level ? ` docs-h${block.level}` : ''}`}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={renderPlaceholder(block.type)}
          onInput={(e) => onChange(index, { content: e.currentTarget.textContent ?? '' })}
          onKeyDown={(e) => onKeyDown(index, e)}
          onFocus={() => onFocus(index)}
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
