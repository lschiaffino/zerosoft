'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ListRuleBuilder, { completeRules, draftRules, type DraftRule } from './ListRuleBuilder';
import type { RuleField } from './listRuleFields';
import type { FilterBuilderRule } from './FilterBuilder';

export interface EnumOption {
  value: string;
  label: string;
}

/** Filtro guardado de una lista dinámica (lib/crm.ts ListFilterJson). */
export interface ListFilterValue {
  q?: string;
  lifecycle?: string;
  leadStatus?: string;
  source?: string;
  filters?: FilterBuilderRule[];
  match?: 'all' | 'any';
}

/** Los filtros rápidos de las listas viejas pasan a ser reglas del constructor. */
export function filterToRules(filter: ListFilterValue): FilterBuilderRule[] {
  const rules: FilterBuilderRule[] = [];
  if (filter.lifecycle) rules.push({ f: 'lifecycle', o: 'is', v: filter.lifecycle });
  if (filter.leadStatus) rules.push({ f: 'leadStatus', o: 'is', v: filter.leadStatus });
  if (filter.source) rules.push({ f: 'source', o: 'is', v: filter.source });
  return [...rules, ...(filter.filters ?? [])];
}

interface ListFormProps {
  fields: RuleField[];
  onCancel: () => void;
  /** Edición del filtro de una lista dinámica existente. */
  edit?: { id: string; name: string; filter: ListFilterValue };
}

/**
 * Nueva lista (nombre + tipo) o edición de una dinámica. Las dinámicas se
 * arman con reglas sobre propiedades, campos propios y actividad, con AND u OR.
 */
export default function ListForm({ fields, onCancel, edit }: ListFormProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(edit?.name ?? '');
  const [kind, setKind] = useState<'static' | 'dynamic'>(edit ? 'dynamic' : 'static');
  const [q, setQ] = useState(edit?.filter.q ?? '');
  const [rules, setRules] = useState<DraftRule[]>(() => draftRules(edit ? filterToRules(edit.filter) : []));
  const [match, setMatch] = useState<'all' | 'any'>(edit?.filter.match ?? 'all');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t('errors.missing_name'));
      return;
    }
    setBusy(true);
    const filter: ListFilterValue = {};
    if (kind === 'dynamic') {
      if (q.trim()) filter.q = q.trim();
      const done = completeRules(rules, fields);
      if (done.length) filter.filters = done;
      if (done.length > 1 && match === 'any') filter.match = 'any';
    }
    const res = await fetch(edit ? `/api/crm/lists/${edit.id}` : '/api/crm/lists', {
      method: edit ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        edit ? { name: name.trim(), filter } : { name: name.trim(), entity: 'contacts', kind, ...(kind === 'dynamic' ? { filter } : {}) },
      ),
    }).catch(() => null);
    if (res && (res.status === 201 || (edit && res.ok))) {
      if (edit) {
        setBusy(false);
        onCancel();
        router.refresh();
        return;
      }
      const created = (await res.json()) as { id: string };
      router.push(`/app/crm/lists/${created.id}`);
      return;
    }
    setError(t('errors.generic'));
    setBusy(false);
  }

  return (
    <form className="crm-form" onSubmit={onSubmit}>
      <div className="ui-fields-2">
        <label className="ui-field">
          <span className="label">{t('lists.nameLabel')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </label>
        {!edit && (
          <label className="ui-field">
            <span className="label">{t('lists.kind')}</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'static' | 'dynamic')}>
              <option value="static">{t('lists.static')}</option>
              <option value="dynamic">{t('lists.dynamic')}</option>
            </select>
          </label>
        )}
      </div>

      {kind === 'dynamic' && (
        <>
          <p className="ui-help">{t('lists.dynamicNote')}</p>
          <ListRuleBuilder fields={fields} rules={rules} match={match} onChange={setRules} onMatch={setMatch} />
          <label className="ui-field">
            <span className="label">{t('lists.filterQ')}</span>
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('common.search')}
              maxLength={500}
            />
          </label>
        </>
      )}

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy || undefined}>
          {edit ? t('listFilters.save') : t('record.createList')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
