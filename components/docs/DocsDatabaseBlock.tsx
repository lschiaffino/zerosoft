'use client';

import type { DocsBlock, DocsDatabaseColumn } from '@/lib/docs-types';
import { defaultDatabaseColumns } from '@/lib/docs-types';
import { useTranslations } from 'next-intl';

interface DocsDatabaseBlockProps {
  block: DocsBlock;
  index: number;
  onChange: (index: number, patch: Partial<DocsBlock>) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus: (index: number) => void;
}

const COLUMN_TYPES: DocsDatabaseColumn['type'][] = ['text', 'number', 'select', 'date'];

const COLUMN_TYPE_LABEL_KEYS = {
  text: 'typeText',
  number: 'typeNumber',
  select: 'typeSelect',
  date: 'typeDate',
} as const;

/** Formatea 'YYYY-MM-DD' (input date) sin corrimiento de timezone. */
function formatDateValue(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Database lite: tabla con columnas tipadas (text/number/select/date) + vista galería. */
export default function DocsDatabaseBlock({
  block,
  index,
  onChange,
  onKeyDown,
  onFocus,
}: DocsDatabaseBlockProps) {
  const t = useTranslations('docs');
  const columns = block.columns?.length ? block.columns : defaultDatabaseColumns();
  const rows = block.rows ?? [];
  const view = block.view ?? 'table';

  const updateColumn = (colIdx: number, patch: Partial<DocsDatabaseColumn>) => {
    onChange(index, {
      columns: columns.map((c, i) => (i === colIdx ? { ...c, ...patch } : c)),
    });
  };

  const addColumn = () => {
    onChange(index, {
      columns: [
        ...columns,
        { id: crypto.randomUUID(), name: t('database.columnName', { n: columns.length + 1 }), type: 'text' },
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

  /** Valor de una propiedad en la galería: select → chip, date → formateada, number → derecha. */
  const renderPropValue = (col: DocsDatabaseColumn, value: string) => {
    if (!value) return <span className="docs-db-prop-empty">—</span>;
    if (col.type === 'select') return <span className="docs-db-chip">{value}</span>;
    if (col.type === 'date') return <span className="mono">{formatDateValue(value)}</span>;
    if (col.type === 'number') return <span className="docs-db-prop-number mono">{value}</span>;
    return <span>{value}</span>;
  };

  const renderGallery = () => {
    const titleIdx = Math.max(0, columns.findIndex((c) => c.type === 'text'));
    const propColumns = columns.filter((_, i) => i !== titleIdx);
    if (rows.length === 0) {
      return <p className="docs-db-gallery-empty">{t('database.emptyGallery')}</p>;
    }
    return (
      <div className="docs-db-gallery">
        {rows.map((row, rowIdx) => (
          <div key={rowIdx} className="docs-db-card">
            <p className="docs-db-card-title">{row[titleIdx] || t('untitled')}</p>
            {propColumns.map((col) => {
              const colIdx = columns.indexOf(col);
              return (
                <div key={col.id} className="docs-db-prop">
                  <span className="docs-db-prop-label">{col.name}</span>
                  <span className="docs-db-prop-value">
                    {renderPropValue(col, row[colIdx] ?? '')}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="docs-table-wrap docs-db-wrap" data-index={index}>
      <div className="docs-db-header">
        <div className="docs-db-view-toggle" role="tablist" aria-label={t('database.view')}>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'table'}
            className={`docs-db-view-btn${view === 'table' ? ' active' : ''}`}
            onClick={() => onChange(index, { view: 'table' })}
          >
            {t('database.viewTable')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'gallery'}
            className={`docs-db-view-btn${view === 'gallery' ? ' active' : ''}`}
            onClick={() => onChange(index, { view: 'gallery' })}
          >
            {t('database.viewGallery')}
          </button>
        </div>
      </div>
      {view === 'gallery' ? (
        renderGallery()
      ) : (
        <>
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
                        {COLUMN_TYPES.map((ct) => (
                          <option key={ct} value={ct}>
                            {t(`database.${COLUMN_TYPE_LABEL_KEYS[ct]}`)}
                          </option>
                        ))}
                      </select>
                      {columns.length > 1 && (
                        <button
                          type="button"
                          className="docs-db-remove"
                          onClick={() => removeColumn(colIdx)}
                          aria-label={t('database.removeColumn')}
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
                      aria-label={t('database.removeRow')}
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
              {t('editor.addRow')}
            </button>
            <button type="button" className="docs-table-add" onClick={addColumn}>
              {t('editor.addColumn')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
