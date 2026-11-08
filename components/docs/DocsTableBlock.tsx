'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsBlock } from '@/lib/docs-types';

const EMPTY: string[][] = [['', ''], ['', '']];
const MAX_ROWS = 200;
const MAX_COLS = 20;

/**
 * Tabla simple como la de Notion: Enter baja a la fila siguiente (y crea una
 * al final), Tab y Shift+Tab van de celda en celda, las flechas arriba y
 * abajo cambian de fila. "+" abajo agrega una fila y "+" a la derecha una
 * columna; la primera fila puede ser encabezado. Recién creada, el foco
 * entra a la primera celda.
 */
export default function DocsTableBlock({
  block,
  index,
  focused,
  readOnly,
  onChange,
  onKeyDown,
  onFocus,
}: {
  block: DocsBlock;
  index: number;
  focused: boolean;
  readOnly?: boolean;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onKeyDown: (index: number, e: KeyboardEvent<HTMLElement>) => void;
  onFocus: (index: number) => void;
}) {
  const t = useTranslations('docs');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rows = block.rows?.length ? block.rows : EMPTY;
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const header = Boolean(block.header_row);

  const copy = () => rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''));
  const cellAt = (r: number, c: number) => rootRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${r}:${c}"]`) ?? null;
  const focusCell = (r: number, c: number) => {
    // La fila o columna nueva aparece en el próximo render.
    requestAnimationFrame(() => cellAt(r, c)?.focus());
  };

  // Recién creada (vacía y enfocada sin que el foco esté en una celda): a la primera celda.
  const fresh = rows.every((r) => r.every((c) => !c));
  useEffect(() => {
    if (readOnly || !focused || !fresh) return;
    if (rootRef.current?.contains(document.activeElement)) return;
    cellAt(0, 0)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const addRow = (at = rows.length) => {
    if (rows.length >= MAX_ROWS) return;
    const next = copy();
    next.splice(at, 0, new Array(cols).fill(''));
    onChange(index, { rows: next });
  };
  const addCol = () => {
    if (cols >= MAX_COLS) return;
    onChange(index, { rows: copy().map((r) => [...r, '']) });
  };

  const onCellKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      // Enter se queda en la tabla: baja una fila (al final, crea una).
      e.preventDefault();
      if (r === rows.length - 1) addRow();
      focusCell(r + 1, c);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (c > 0) focusCell(r, c - 1);
        else if (r > 0) focusCell(r - 1, cols - 1);
        return;
      }
      if (c < cols - 1) focusCell(r, c + 1);
      else {
        if (r === rows.length - 1) addRow();
        focusCell(r + 1, 0);
      }
      return;
    }
    if ((e.key === 'ArrowDown' && r < rows.length - 1) || (e.key === 'ArrowUp' && r > 0)) {
      e.preventDefault();
      focusCell(e.key === 'ArrowDown' ? r + 1 : r - 1, c);
      return;
    }
    // Lo demás (Esc, Cmd+Enter para salir, flechas en los bordes) lo maneja el editor.
    onKeyDown(index, e);
  };

  return (
    <div className={`docs-table-wrap${header ? ' has-header' : ''}`} data-index={index} ref={rootRef}>
      <div className="docs-table-scroll">
        <table className="docs-table">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => {
                  const Cell = header && r === 0 ? 'th' : 'td';
                  return (
                    <Cell key={c} scope={header && r === 0 ? 'col' : undefined}>
                      <input
                        className="docs-table-cell"
                        data-cell={`${r}:${c}`}
                        aria-label={t('editor.table.cell', { row: r + 1, col: c + 1 })}
                        value={row[c] ?? ''}
                        readOnly={readOnly}
                        onChange={(e) => {
                          const next = copy();
                          next[r][c] = e.target.value;
                          onChange(index, { rows: next });
                        }}
                        onKeyDown={(e) => onCellKey(e, r, c)}
                        onFocus={() => onFocus(index)}
                      />
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!readOnly && (
          <button type="button" className="docs-table-addcol" aria-label={t('editor.table.addColumn')} title={t('editor.table.addColumn')} onClick={addCol} disabled={cols >= MAX_COLS}>
            +
          </button>
        )}
      </div>
      {!readOnly && (
        <div className="docs-table-bar">
          <button type="button" className="docs-table-add" onClick={() => addRow()} disabled={rows.length >= MAX_ROWS}>
            {t('editor.addRow')}
          </button>
          <label className="docs-table-header-toggle">
            <input type="checkbox" checked={header} onChange={(e) => onChange(index, { header_row: e.target.checked || undefined })} />
            {t('editor.table.headerRow')}
          </label>
        </div>
      )}
    </div>
  );
}
