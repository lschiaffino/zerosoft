import '@/styles/docs-database.css';
import type { DbProperty, DbRow, DbStatusGroup } from '@/lib/docs-types';
import {
  cellValue,
  dbValueHref,
  formatDate,
  formatNumber,
  formatTimestamp,
  isEmptyValue,
  optionById,
} from '@/lib/docs-database';

/**
 * Valor de una celda para mostrar (tabla, board, galería, panel de la fila y
 * vistas de solo lectura). Sin hooks: sirve en el server (centro de ayuda).
 */

/** Marca del grupo de status: vacío (to-do), mitad (en curso), lleno (hecho). */
export function StatusGlyph({ group }: { group: DbStatusGroup }) {
  return (
    <svg className={`docs-db-status-glyph is-${group}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {group === 'in_progress' && <rect x="1" y="1" width="5" height="10" fill="currentColor" />}
      {group === 'done' && <rect x="1" y="1" width="10" height="10" fill="currentColor" />}
    </svg>
  );
}

export function CheckboxGlyph({ checked }: { checked: boolean }) {
  return (
    <svg className={`docs-db-check${checked ? ' on' : ''}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <rect x="0.75" y="0.75" width="12.5" height="12.5" fill={checked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" />
      {checked && <path d="M3.5 7.2l2.3 2.3 4.7-5" fill="none" stroke="var(--bg)" strokeWidth="1.6" />}
    </svg>
  );
}

export default function DbValueView({
  prop,
  row,
  people,
  locale,
  links = true,
}: {
  prop: DbProperty;
  row: DbRow;
  people?: Record<string, string>;
  locale?: string;
  /** URL/email/teléfono como link (en la tabla editable el click edita: va el botón aparte). */
  links?: boolean;
}) {
  const v = cellValue(prop, row);
  if (prop.type === 'checkbox') {
    return (
      <span className="docs-db-v docs-db-v-check" role="img" aria-label={v === true ? '✓' : '–'}>
        <CheckboxGlyph checked={v === true} />
      </span>
    );
  }
  if (isEmptyValue(v)) return null;
  switch (prop.type) {
    case 'number':
      return <span className="docs-db-v docs-db-v-number mono">{typeof v === 'number' ? formatNumber(v, locale) : ''}</span>;
    case 'select':
    case 'status': {
      const o = optionById(prop, v);
      if (!o) return null;
      return (
        <span className={`docs-db-chip${prop.type === 'status' ? ' docs-db-chip-status' : ''}`}>
          {prop.type === 'status' && <StatusGlyph group={o.group ?? 'todo'} />}
          {o.name}
        </span>
      );
    }
    case 'multi_select':
      return (
        <span className="docs-db-v docs-db-chips">
          {(Array.isArray(v) ? v : []).map((id) => {
            const o = optionById(prop, id);
            return o ? (
              <span key={id} className="docs-db-chip">
                {o.name}
              </span>
            ) : null;
          })}
        </span>
      );
    case 'person':
      return (
        <span className="docs-db-v docs-db-chips">
          {(Array.isArray(v) ? v : []).map((id) => {
            const name = people?.[id];
            if (!name) return null;
            return (
              <span key={id} className="docs-db-person">
                <span className="docs-db-avatar" aria-hidden="true">
                  {name.trim().charAt(0).toUpperCase()}
                </span>
                {name}
              </span>
            );
          })}
        </span>
      );
    case 'date':
      return <span className="docs-db-v mono">{typeof v === 'string' ? formatDate(v, locale) : ''}</span>;
    case 'created_time':
    case 'last_edited_time':
      return <span className="docs-db-v docs-db-v-muted">{typeof v === 'string' ? formatTimestamp(v, locale) : ''}</span>;
    case 'url':
    case 'email':
    case 'phone': {
      const href = links ? dbValueHref(prop.type, v) : null;
      const text = String(v);
      if (!href) return <span className="docs-db-v docs-db-v-text">{text}</span>;
      return (
        <a
          className="docs-db-v docs-db-v-link"
          href={href}
          {...(prop.type === 'url' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {text}
        </a>
      );
    }
    default:
      return <span className="docs-db-v docs-db-v-text">{String(v)}</span>;
  }
}
