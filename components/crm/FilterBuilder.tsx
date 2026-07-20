'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

export type FilterBuilderFieldType = 'text' | 'number' | 'select' | 'date';

export interface FilterBuilderOption {
  value: string;
  label: string;
}

export interface FilterBuilderField {
  key: string;
  label: string;
  type: FilterBuilderFieldType;
  options?: FilterBuilderOption[];
}

/** Misma forma que FilterRule en lib/crm.ts (claves cortas para URL compacta). */
export interface FilterBuilderRule {
  f: string;
  o: string;
  v?: string;
  v2?: string;
}

interface FilterBuilderProps {
  fields: FilterBuilderField[];
  /** Reglas actualmente aplicadas (parseadas del query param en el server). */
  initial: FilterBuilderRule[];
  /** Query params vigentes (quick filters, sort, view, pipeline…) a preservar al navegar. */
  baseQuery: Record<string, string>;
}

const OPS_BY_TYPE: Record<FilterBuilderFieldType, string[]> = {
  text: ['contains', 'equals', 'starts'],
  number: ['eq', 'neq', 'gt', 'lt'],
  select: ['is', 'isnot'],
  date: ['before', 'after', 'between'],
};

const DEFAULT_OP: Record<FilterBuilderFieldType, string> = {
  text: 'contains',
  number: 'eq',
  select: 'is',
  date: 'after',
};

let rowSeq = 0;

interface Row extends FilterBuilderRule {
  _id: number;
}

/**
 * Constructor de filtros avanzados: filas [propiedad] [operador] [valor]
 * combinadas con AND. Serializa a `?filters=<json>` (ver parseFilterRules en
 * lib/crm.ts). Los quick filters existentes se preservan vía baseQuery.
 */
export default function FilterBuilder({ fields, initial, baseQuery }: FilterBuilderProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(initial.length > 0);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((r) => ({ ...r, _id: ++rowSeq })),
  );

  function fieldDef(key: string): FilterBuilderField | undefined {
    return fields.find((f) => f.key === key);
  }

  function addRow() {
    const first = fields[0];
    if (!first) return;
    setRows((prev) => [...prev, { _id: ++rowSeq, f: first.key, o: DEFAULT_OP[first.type], v: '' }]);
  }

  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r._id !== id));
  }

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r._id !== id) return r;
        const next = { ...r, ...patch };
        // Cambio de propiedad: resetear operador/valor si cambió el tipo.
        if (patch.f !== undefined && patch.f !== r.f) {
          const type = fieldDef(patch.f)?.type ?? 'text';
          next.o = DEFAULT_OP[type];
          next.v = '';
          next.v2 = undefined;
        }
        return next;
      }),
    );
  }

  /** Reglas completas (las incompletas se descartan al aplicar). */
  function validRows(list: Row[]): FilterBuilderRule[] {
    const out: FilterBuilderRule[] = [];
    for (const r of list) {
      const def = fieldDef(r.f);
      if (!def || !r.o) continue;
      const v = (r.v ?? '').trim();
      if (!v) continue;
      const rule: FilterBuilderRule = { f: r.f, o: r.o, v };
      if (def.type === 'date' && r.o === 'between') {
        const v2 = (r.v2 ?? '').trim();
        if (!v2) continue;
        rule.v2 = v2;
      }
      out.push(rule);
    }
    return out;
  }

  function navigate(rules: FilterBuilderRule[]) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(baseQuery)) {
      if (value && key !== 'filters' && key !== 'page') params.set(key, value);
    }
    if (rules.length) params.set('filters', JSON.stringify(rules));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function apply() {
    navigate(validRows(rows));
  }

  function clearAll() {
    setRows([]);
    navigate([]);
  }

  const activeCount = initial.length;
  const draftCount = validRows(rows).length;

  return (
    <div className="filter-builder">
      <div className="filter-builder-head">
        <button
          type="button"
          className={`btn btn-ghost btn-small${open ? ' filter-builder-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {t('filters.advanced')}
          {activeCount > 0 && <span className="filter-builder-count mono">{activeCount}</span>}
        </button>
        {activeCount > 0 && (
          <button type="button" className="btn btn-ghost btn-small filter-clear" onClick={clearAll}>
            {t('filters.clearAll')}
          </button>
        )}
      </div>

      {open && (
        <div className="filter-builder-body">
          {rows.length === 0 ? (
            <p className="muted filter-builder-empty">{t('filters.empty')}</p>
          ) : (
            <div className="filter-builder-rows">
              {rows.map((row, i) => {
                const def = fieldDef(row.f);
                const type = def?.type ?? 'text';
                const ops = OPS_BY_TYPE[type];
                return (
                  <div key={row._id} className="filter-builder-row-wrap">
                    {i > 0 && <span className="filter-builder-and mono">{t('filters.and')}</span>}
                    <div className="filter-builder-row">
                      <select
                        className="select filter-builder-prop"
                        value={row.f}
                        onChange={(e) => updateRow(row._id, { f: e.target.value })}
                        aria-label={t('filters.property')}
                      >
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="select filter-builder-op"
                        value={row.o}
                        onChange={(e) => updateRow(row._id, { o: e.target.value })}
                        aria-label={t('filters.operator')}
                      >
                        {ops.map((op) => (
                          <option key={op} value={op}>
                            {t(`filters.op.${op}`)}
                          </option>
                        ))}
                      </select>
                      {type === 'select' ? (
                        <select
                          className="select filter-builder-value"
                          value={row.v ?? ''}
                          onChange={(e) => updateRow(row._id, { v: e.target.value })}
                          aria-label={t('filters.value')}
                        >
                          <option value="">—</option>
                          {(def?.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : type === 'date' ? (
                        <>
                          <input
                            className="input filter-builder-value"
                            type="date"
                            value={row.v ?? ''}
                            onChange={(e) => updateRow(row._id, { v: e.target.value })}
                            aria-label={t('filters.value')}
                          />
                          {row.o === 'between' && (
                            <input
                              className="input filter-builder-value"
                              type="date"
                              value={row.v2 ?? ''}
                              onChange={(e) => updateRow(row._id, { v2: e.target.value })}
                              aria-label={t('filters.valueTo')}
                            />
                          )}
                        </>
                      ) : (
                        <input
                          className="input filter-builder-value"
                          type={type === 'number' ? 'number' : 'text'}
                          value={row.v ?? ''}
                          onChange={(e) => updateRow(row._id, { v: e.target.value })}
                          placeholder={t('filters.value')}
                          aria-label={t('filters.value')}
                        />
                      )}
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => removeRow(row._id)}
                        aria-label={t('filters.removeRule')}
                        title={t('filters.removeRule')}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="filter-builder-actions">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={addRow}
              disabled={fields.length === 0}
            >
              {t('filters.addRule')}
            </button>
            <button
              type="button"
              className="btn btn-solid btn-small"
              onClick={apply}
              disabled={draftCount === 0 && activeCount === 0}
            >
              {t('filters.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
