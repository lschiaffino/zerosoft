'use client';

import { useTranslations } from 'next-intl';
import CrmIcon from './CrmIcon';
import type { FilterBuilderRule } from './FilterBuilder';
import type { RuleField } from './listRuleFields';

const OPS: Record<RuleField['type'], string[]> = {
  text: ['contains', 'equals', 'starts'],
  number: ['eq', 'neq', 'gt', 'lt'],
  select: ['is', 'isnot'],
  date: ['before', 'after', 'between'],
};

const DEFAULT_OP: Record<RuleField['type'], string> = { text: 'contains', number: 'gt', select: 'is', date: 'after' };

export interface DraftRule extends FilterBuilderRule {
  _id: number;
}

let seq = 0;
export function draftRules(rules: FilterBuilderRule[]): DraftRule[] {
  return rules.map((r) => ({ ...r, _id: ++seq }));
}

/** Reglas completas (las vacías se descartan). */
export function completeRules(rules: DraftRule[], fields: RuleField[]): FilterBuilderRule[] {
  const out: FilterBuilderRule[] = [];
  for (const r of rules) {
    const def = fields.find((f) => f.key === r.f);
    const v = (r.v ?? '').trim();
    if (!def || !r.o || !v) continue;
    if (def.type === 'date' && r.o === 'between') {
      const v2 = (r.v2 ?? '').trim();
      if (!v2) continue;
      out.push({ f: r.f, o: r.o, v, v2 });
    } else out.push({ f: r.f, o: r.o, v });
  }
  return out;
}

/**
 * Constructor de reglas de una lista dinámica: propiedades, campos propios y
 * actividad, combinadas con AND (todas) u OR (alguna). Controlado: el padre
 * guarda las reglas.
 */
export default function ListRuleBuilder({
  fields,
  rules,
  match,
  onChange,
  onMatch,
}: {
  fields: RuleField[];
  rules: DraftRule[];
  match: 'all' | 'any';
  onChange: (rules: DraftRule[]) => void;
  onMatch: (m: 'all' | 'any') => void;
}) {
  const t = useTranslations('crm');
  const groups: Array<{ key: RuleField['group']; label: string }> = [
    { key: 'props', label: t('listFilters.groupProps') },
    { key: 'custom', label: t('listFilters.groupCustom') },
    { key: 'activity', label: t('listFilters.groupActivity') },
  ];

  function update(id: number, patch: Partial<DraftRule>) {
    onChange(
      rules.map((r) => {
        if (r._id !== id) return r;
        const next = { ...r, ...patch };
        if (patch.f !== undefined && patch.f !== r.f) {
          const type = fields.find((f) => f.key === patch.f)?.type ?? 'text';
          next.o = DEFAULT_OP[type];
          next.v = '';
          next.v2 = undefined;
        }
        return next;
      }),
    );
  }

  function add() {
    const first = fields[0];
    if (first) onChange([...rules, { _id: ++seq, f: first.key, o: DEFAULT_OP[first.type], v: '' }]);
  }

  return (
    <div className="list-rules" data-testid="list-rules">
      <div className="list-rules-head">
        <span className="label">{t('listFilters.title')}</span>
        {rules.length > 1 && (
          <label className="list-rules-match">
            <span>{t('listFilters.match')}</span>
            <select className="filter-select" value={match} onChange={(e) => onMatch(e.target.value === 'any' ? 'any' : 'all')}>
              <option value="all">{t('listFilters.matchAll')}</option>
              <option value="any">{t('listFilters.matchAny')}</option>
            </select>
          </label>
        )}
      </div>
      {rules.length === 0 ? (
        <p className="muted">{t('listFilters.empty')}</p>
      ) : (
        <ol className="list-rules-rows">
          {rules.map((r, i) => {
            const def = fields.find((f) => f.key === r.f);
            const type = def?.type ?? 'text';
            return (
              <li key={r._id} className="list-rule">
                {i > 0 && <span className="list-rule-join mono">{match === 'any' ? t('listFilters.or') : t('listFilters.and')}</span>}
                <div className="filter-builder-row">
                  <select
                    className="select filter-builder-prop"
                    value={r.f}
                    onChange={(e) => update(r._id, { f: e.target.value })}
                    aria-label={t('filters.property')}
                  >
                    {groups.map((g) => {
                      const list = fields.filter((f) => f.group === g.key);
                      if (!list.length) return null;
                      return (
                        <optgroup key={g.key} label={g.label}>
                          {list.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <select
                    className="select filter-builder-op"
                    value={r.o}
                    onChange={(e) => update(r._id, { o: e.target.value })}
                    aria-label={t('filters.operator')}
                  >
                    {OPS[type].map((op) => (
                      <option key={op} value={op}>
                        {t(`filters.op.${op}`)}
                      </option>
                    ))}
                  </select>
                  {type === 'select' ? (
                    <select
                      className="select filter-builder-value"
                      value={r.v ?? ''}
                      onChange={(e) => update(r._id, { v: e.target.value })}
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
                        value={r.v ?? ''}
                        onChange={(e) => update(r._id, { v: e.target.value })}
                        aria-label={t('filters.value')}
                      />
                      {r.o === 'between' && (
                        <input
                          className="input filter-builder-value"
                          type="date"
                          value={r.v2 ?? ''}
                          onChange={(e) => update(r._id, { v2: e.target.value })}
                          aria-label={t('filters.valueTo')}
                        />
                      )}
                    </>
                  ) : (
                    <input
                      className="input filter-builder-value"
                      type={type === 'number' ? 'number' : 'text'}
                      value={r.v ?? ''}
                      onChange={(e) => update(r._id, { v: e.target.value })}
                      placeholder={t('filters.value')}
                      aria-label={t('filters.value')}
                    />
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onChange(rules.filter((x) => x._id !== r._id))}
                    aria-label={t('listFilters.removeRule')}
                    title={t('listFilters.removeRule')}
                  >
                    <CrmIcon name="x" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <button type="button" className="btn btn-ghost btn-small" onClick={add} disabled={!fields.length}>
        {t('listFilters.addRule')}
      </button>
    </div>
  );
}
