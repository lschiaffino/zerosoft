import '@/styles/docs-database.css';
import '@/styles/docs-database-views.css';
import type { DbProperty, DbRow, DbStatusGroup } from '@/lib/docs-types';
import {
  cellValue,
  dbValueHref,
  effectiveType,
  formatDate,
  formatNumber,
  formatTimestamp,
  formatUniqueId,
  formatValue,
  isEmptyValue,
  optionById,
} from '@/lib/docs-database';

/** Lo que una celda necesita de afuera para relaciones, archivos y botones. */
export interface DbRefs {
  /** id de fila → título (de esta base y de las relacionadas). */
  titles?: Record<string, string>;
  /** URL de un archivo de una propiedad files (null: sin acceso al archivo). */
  fileHref?: (fileId: string, opts?: { download?: boolean }) => string | null;
  /** Click en un botón de la fila. */
  onButton?: (prop: DbProperty, row: DbRow) => void;
  /** Botón corriendo (deshabilitado mientras tanto). */
  busyButton?: string | null;
  /** Etiquetas sin hooks (sirve en el server). */
  labels?: { untitled?: string; error?: string; openMap?: string };
}

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
  refs,
}: {
  prop: DbProperty;
  row: DbRow;
  people?: Record<string, string>;
  locale?: string;
  /** URL/email/teléfono como link (en la tabla editable el click edita: va el botón aparte). */
  links?: boolean;
  refs?: DbRefs;
}) {
  const v = cellValue(prop, row);
  if (prop.type === 'button') {
    const label = prop.button?.label || prop.name;
    if (!refs?.onButton) return <span className="docs-db-btnprop is-static">{label}</span>;
    return (
      <button
        type="button"
        className="docs-db-btnprop"
        disabled={refs.busyButton === `${prop.id}:${row.id}`}
        onClick={(e) => {
          e.stopPropagation();
          refs.onButton?.(prop, row);
        }}
      >
        {label}
      </button>
    );
  }
  if ((prop.type === 'formula' || prop.type === 'rollup') && prop.error && prop.type === 'formula') {
    return (
      <span className="docs-db-v docs-db-v-error" title={prop.error}>
        {refs?.labels?.error ?? 'Error'}
      </span>
    );
  }
  const type = effectiveType(prop);
  if (type === 'checkbox' && (prop.type === 'formula' || prop.type === 'rollup')) {
    if (v === null || v === undefined) return null;
    return (
      <span className="docs-db-v docs-db-v-check" role="img" aria-label={v === true ? '✓' : '–'}>
        <CheckboxGlyph checked={v === true} />
      </span>
    );
  }
  if (prop.type === 'checkbox') {
    return (
      <span className="docs-db-v docs-db-v-check" role="img" aria-label={v === true ? '✓' : '–'}>
        <CheckboxGlyph checked={v === true} />
      </span>
    );
  }
  if (isEmptyValue(v)) return null;
  if (prop.type === 'unique_id') return <span className="docs-db-v docs-db-v-number mono">{formatUniqueId(prop, v)}</span>;
  if (prop.type === 'formula' || prop.type === 'rollup') {
    const text = formatValue(prop, row, { people, locale });
    return <span className={`docs-db-v${type === 'number' ? ' docs-db-v-number mono' : type === 'date' ? ' mono' : ' docs-db-v-text'}`}>{text}</span>;
  }
  if (prop.type === 'relation') {
    return (
      <span className="docs-db-v docs-db-chips">
        {(Array.isArray(v) ? v : []).map((id) => (
          <span key={id} className="docs-db-relchip">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
              <path d="M7 3h7l4 4v14H7zM14 3v4h4" />
            </svg>
            {refs?.titles?.[id] || refs?.labels?.untitled || '…'}
          </span>
        ))}
      </span>
    );
  }
  if (prop.type === 'files') {
    const files = row.files?.[prop.id] ?? [];
    return (
      <span className="docs-db-v docs-db-chips">
        {files.map((f) => {
          const href = links && f.url ? refs?.fileHref?.(f.id) : null;
          return href ? (
            <a key={f.id} className="docs-db-filechip" href={href} target="_blank" rel="noopener noreferrer">
              {f.name}
            </a>
          ) : (
            <span key={f.id} className="docs-db-filechip">
              {f.name}
            </span>
          );
        })}
      </span>
    );
  }
  if (prop.type === 'created_by' || prop.type === 'last_edited_by') {
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
  }
  if (prop.type === 'place') {
    const text = String(v);
    if (!links) return <span className="docs-db-v docs-db-v-text">{text}</span>;
    return (
      <a
        className="docs-db-v docs-db-v-link"
        href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noopener noreferrer"
        title={refs?.labels?.openMap}
      >
        {text}
      </a>
    );
  }
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
