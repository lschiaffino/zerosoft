'use client';

import { useTranslations } from 'next-intl';
import { MAX_COLUMNS, TABLE_COLUMN_TYPES, type FlowTableColumn, type TableColumnType } from '@/lib/flow-tables-schema';

interface Props {
  idPrefix: string;
  columns: FlowTableColumn[];
  onChange: (columns: FlowTableColumn[]) => void;
  readOnly?: boolean;
}

/** Columnas de una tabla de datos: nombre (como una variable) y tipo. */
export default function TableColumnsEditor({ idPrefix, columns, onChange, readOnly }: Props) {
  const t = useTranslations('flow.tables');
  const tf = useTranslations('flow');
  return (
    <div className="flow-rows">
      {columns.map((c, i) => (
        <div className="flow-kv flow-col-row" key={i}>
          <input
            id={`${idPrefix}-name-${i}`}
            className="input data"
            value={c.name}
            placeholder="email"
            maxLength={40}
            aria-label={t('columnName')}
            readOnly={readOnly}
            onChange={(e) => onChange(columns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <select
            className="select"
            value={c.type}
            aria-label={t('columnType')}
            disabled={readOnly}
            onChange={(e) => onChange(columns.map((x, j) => (j === i ? { ...x, type: e.target.value as TableColumnType } : x)))}
          >
            {TABLE_COLUMN_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </select>
          {!readOnly && (
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={tf('editor.remove')}
              title={tf('editor.remove')}
              onClick={() => onChange(columns.filter((_, j) => j !== i))}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>
      ))}
      {!readOnly && columns.length < MAX_COLUMNS && (
        <button
          type="button"
          className="btn btn-ghost btn-sm flow-add"
          onClick={() => onChange([...columns, { name: '', type: 'text' }])}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t('addColumn')}
        </button>
      )}
      <p className="ui-help">{t('columnHint')}</p>
    </div>
  );
}
