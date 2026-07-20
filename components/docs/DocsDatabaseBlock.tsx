'use client';

import type { DocsBlock, DocsDatabaseColumn } from '@/lib/docs-types';
import { defaultDatabaseColumns } from '@/lib/docs-types';

interface DocsDatabaseBlockProps {
  block: DocsBlock;
  index: number;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus: (index: number) => void;
}

const COLUMN_TYPES: DocsDatabaseColumn['type'][] = ['text', 'number', 'select', 'date'];

/** Database lite: tabla con columnas tipadas (text/number/select/date). */
export default function DocsDatabaseBlock({
  block,
  index,
  onChange,
  onKeyDown,
  onFocus,
}: DocsDatabaseBlockProps) {
  const columns = block.columns?.length ? block.columns : defaultDatabaseColumns();
  const rows = block.rows ?? [];

  const updateColumn = (colIdx: number, patch: Partial<DocsDatabaseColumn>) => {
    onChange(index, {
      columns: columns.map((c, i) => (i === colIdx ? { ...c, ...patch } : c)),
    });
  };

  const addColumn = () => {
    onChange(index, {
      columns: [
        ...columns,
        { id: crypto.randomUUID(), name: `Column ${columns.length + 1}`, type: 'text' },
      ],
      rows: rows.map((r) => [...r, '']),
    });
  };

  const removeColumn = (colIdx: number) => {
    if (columns.length <= 1) return;
    onChange(index, {
      columns: columns.filter((_, i) => i !== colIdx),
      rows: rows.map((r) => r.filter((_, i) => i !== colIdx)),
    });
  };

  const addRow = () => {
    onChange(index, { rows: [...rows, new Array(columns.length).fill('')] });
  };

  const removeRow = (rowIdx: number) => {
    onChange(index, { rows: rows.filter((_, i) => i !== rowIdx) });
  };

  const setCell = (rowIdx: number, colIdx: number, value: string) => {
    onChange(index, {
      rows: rows.map((r, i) =>
        i === rowIdx ? columns.map((_, j) => (j === colIdx ? value : r[j] ?? '')) : r,
      ),
    });
  };

  const renderCell = (col: DocsDatabaseColumn, value: string, rowIdx: number, colIdx: number) => {
    if (col.type === 'select') {
      return (
        <select
          className="docs-db-cell-select"
          value={value}
          onChange={(e) => setCell(rowIdx, colIdx, e.target.value)}
          onFocus={() => onFocus(index)}
        >
          <option value="">—</option>
          {(col.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        className="docs-table-cell"
        type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
        value={value}
        onChange={(e) => setCell(rowIdx, colIdx, e.target.value)}
        onKeyDown={(e) => onKeyDown(index, e)}
        onFocus={() => onFocus(index)}
      />
    );
  };

  return (
    <div className="docs-table-wrap docs-db-wrap" data-index={index}>
      <table className="docs-table docs-db-table">
        <thead>
          <tr>
            {columns.map((col, colIdx) => (
              <th key={col.id}>
                <div className="docs-db-head">
                  <input
                    className="docs-db-name"
                    value={col.name}
                    onChange={(e) => updateColumn(colIdx, { name: e.target.value })}
                    onKeyDown={(e) => onKeyDown(index, e)}
                    onFocus={() => onFocus(index)}
                  />
                  <select
                    className="docs-db-type"
                    value={col.type}
                    onChange={(e) =>
                      updateColumn(colIdx, {
                        type: e.target.value as DocsDatabaseColumn['type'],
                      })
                    }
                  >
                    {COLUMN_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {columns.length > 1 && (
                    <button
                      type="button"
                      className="docs-db-remove"
                      onClick={() => removeColumn(colIdx)}
                      aria-label="Remove column"
                    >
                      ×
                    </button>
                  )}
                </div>
                {col.type === 'select' && (
                  <input
                    key={`${col.id}-opts`}
                    className="docs-db-options"
                    defaultValue={(col.options ?? []).join(', ')}
                    placeholder="opt1, opt2…"
                    onBlur={(e) =>
                      updateColumn(colIdx, {
                        options: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                )}
              </th>
            ))}
            <th className="docs-db-row-head" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {columns.map((col, colIdx) => (
                <td key={col.id}>{renderCell(col, row[colIdx] ?? '', rowIdx, colIdx)}</td>
              ))}
              <td className="docs-db-row-actions">
                <button
                  type="button"
                  className="docs-db-remove"
                  onClick={() => removeRow(rowIdx)}
                  aria-label="Remove row"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="docs-db-actions">
        <button type="button" className="docs-table-add" onClick={addRow}>
          + row
        </button>
        <button type="button" className="docs-table-add" onClick={addColumn}>
          + column
        </button>
      </div>
    </div>
  );
}
