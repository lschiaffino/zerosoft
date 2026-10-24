'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ListForm, { filterToRules, type ListFilterValue } from './ListForm';
import type { RuleField } from './listRuleFields';

/** Filtro de una lista dinámica: lo que pide, en texto, y su edición en el lugar. */
export default function DynamicListFilter({
  listId,
  name,
  filter,
  fields,
}: {
  listId: string;
  name: string;
  filter: ListFilterValue;
  fields: RuleField[];
}) {
  const t = useTranslations('crm');
  const [editing, setEditing] = useState(false);
  const rules = filterToRules(filter);
  const join = filter.match === 'any' ? t('listFilters.or') : t('listFilters.and');

  const describe = (r: { f: string; o: string; v?: string; v2?: string }) => {
    const def = fields.find((f) => f.key === r.f);
    const value =
      def?.type === 'select' ? (def.options?.find((o) => o.value === r.v)?.label ?? r.v) : r.o === 'between' ? `${r.v} – ${r.v2}` : r.v;
    return `${def?.label ?? r.f} ${t(`filters.op.${r.o}`)} ${value ?? ''}`.trim();
  };

  if (editing) {
    return (
      <div className="record-inline-form">
        <ListForm fields={fields} edit={{ id: listId, name, filter }} onCancel={() => setEditing(false)} />
      </div>
    );
  }
  return (
    <div role="region" className="list-filter-summary" aria-label={t('listFilters.title')} data-testid="list-filter-summary">
      <p>
        {rules.length === 0 && !filter.q ? (
          <span className="muted">{t('listFilters.empty')}</span>
        ) : (
          <>
            {rules.map((r, i) => (
              <span key={`${r.f}-${i}`}>
                {i > 0 && <span className="muted"> {join} </span>}
                <span className="list-filter-rule">{describe(r)}</span>
              </span>
            ))}
            {filter.q && (
              <span>
                {rules.length > 0 && <span className="muted"> {t('listFilters.and')} </span>}
                <span className="list-filter-rule">
                  {t('lists.filterQ')}: {filter.q}
                </span>
              </span>
            )}
          </>
        )}
      </p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
        {t('listFilters.edit')}
      </button>
    </div>
  );
}
