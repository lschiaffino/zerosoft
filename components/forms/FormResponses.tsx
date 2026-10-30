'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { FormDto } from '@/lib/forms/core';
import type { ResponseDto } from '@/lib/forms/responses';
import { answerDisplay } from '@/lib/forms/engine';
import { NO_ANSWER_TYPES } from '@/lib/forms/types';
import { FormTabs } from './ui';

interface Filters {
  status: 'completed' | 'partial';
  q: string;
  from: string;
  to: string;
  question: string;
  value: string;
  page: number;
  pageSize: number;
}

/** Tabla de respuestas: filtros, búsqueda, completas o parciales, borrar y CSV con los mismos filtros. */
export default function FormResponses({ form, rows, total, filters }: { form: FormDto; rows: ResponseDto[]; total: number; filters: Filters }) {
  const t = useTranslations('forms.responses');
  const tp = useTranslations('forms.public');
  const format = useFormatter();
  const router = useRouter();
  const [f, setF] = useState(filters);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const labels = { yes: tp('yes'), no: tp('no'), file: tp('file'), signed: tp('signed') };
  const cols = form.definition.questions.filter((q) => !NO_ANSWER_TYPES.includes(q.type)).slice(0, 4);
  const params = (next: Partial<Filters>) => {
    const v = { ...f, ...next };
    const sp = new URLSearchParams();
    if (v.status === 'partial') sp.set('status', 'partial');
    if (v.q.trim()) sp.set('q', v.q.trim());
    if (v.from) sp.set('from', v.from);
    if (v.to) sp.set('to', v.to);
    if (v.question && v.value.trim()) {
      sp.set('question', v.question);
      sp.set('value', v.value.trim());
    }
    if (v.page > 1) sp.set('page', String(v.page));
    return sp;
  };
  const go = (next: Partial<Filters>) => {
    const sp = params({ page: 1, ...next });
    router.push(`/app/forms/${form.id}/responses${sp.size ? `?${sp}` : ''}`);
  };
  const exportSp = params({ page: 1 });
  const filtered = Boolean(f.q || f.from || f.to || (f.question && f.value));
  const pages = Math.max(1, Math.ceil(total / filters.pageSize));

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/forms/${form.id}/responses`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: selected }) }).catch(() => null);
    setBusy(false);
    setConfirm(false);
    if (!res?.ok) {
      setError(t('deleteError'));
      return;
    }
    setSelected([]);
    router.refresh();
  }

  return (
    <div className="app-page ui-page fm-page">
      <PageHeader
        title={form.name}
        description={filters.status === 'partial' ? t('countPartial', { n: total }) : t('count', { n: total })}
        back={{ href: '/app/forms', label: t('back') }}
        actions={
          <a className="btn btn-secondary" href={`/api/forms/${form.id}/export${exportSp.size ? `?${exportSp}` : ''}`} download>
            {t('export')}
          </a>
        }
      />
      <FormTabs id={form.id} active="responses" />
      <form
        className="fm-filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go({});
        }}
      >
        <div className="btn-group" role="group" aria-label={t('statusLabel')}>
          {(['completed', 'partial'] as const).map((s) => (
            <button key={s} type="button" className="btn btn-secondary btn-sm" aria-pressed={filters.status === s} onClick={() => go({ status: s })}>
              {t(`status.${s}`)}
            </button>
          ))}
        </div>
        <input className="input input-sm" type="search" aria-label={t('search')} placeholder={t('search')} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <label className="fm-inline">
          <span>{t('from')}</span>
          <input className="input input-sm" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </label>
        <label className="fm-inline">
          <span>{t('to')}</span>
          <input className="input input-sm" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </label>
        <select className="select select-sm" aria-label={t('whereQuestion')} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })}>
          <option value="">{t('anyQuestion')}</option>
          {form.definition.questions
            .filter((q) => !NO_ANSWER_TYPES.includes(q.type))
            .map((q) => (
              <option key={q.id} value={q.id}>
                {q.title || q.ref}
              </option>
            ))}
        </select>
        {f.question && <input className="input input-sm" aria-label={t('whereValue')} placeholder={t('whereValue')} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}
        <button type="submit" className="btn btn-secondary btn-sm">
          {t('apply')}
        </button>
        {filtered && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ q: '', from: '', to: '', question: '', value: '' })}>
            {t('clear')}
          </button>
        )}
      </form>
      {selected.length > 0 && (
        <div className="fm-bulk" role="region" aria-label={t('selection')}>
          <span>{t('selected', { n: selected.length })}</span>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>
            {t('delete')}
          </button>
        </div>
      )}
      {error && (
        <p className="fm-error" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        filtered ? (
          <EmptyState compact body={t('noMatch')} />
        ) : (
          <EmptyState product="forms" title={t('emptyTitle')} body={filters.status === 'partial' ? t('emptyPartial') : t('emptyBody')} action={{ label: t('share'), href: `/app/forms/${form.id}/share` }} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table fm-table fm-responses">
            <thead>
              <tr>
                <th scope="col" className="fm-col-check">
                  <label className="ui-check">
                    <input type="checkbox" aria-label={t('selectAll')} checked={selected.length === rows.length} onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])} />
                  </label>
                </th>
                <th scope="col">{t('date')}</th>
                {cols.map((q) => (
                  <th key={q.id} scope="col" className="fm-hide-sm">
                    {q.title || q.ref}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="fm-col-check">
                    <label className="ui-check">
                      <input type="checkbox" aria-label={t('selectOne', { date: format.dateTime(new Date(r.submittedAt ?? r.createdAt), { dateStyle: 'medium', timeStyle: 'short' }) })} checked={selected.includes(r.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} />
                    </label>
                  </td>
                  <th scope="row">
                    <Link href={`/app/forms/${form.id}/responses/${r.id}`} className="fm-rowlink">
                      <span className="fm-rowtitle">{format.dateTime(new Date(r.submittedAt ?? r.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      <span className="fm-rowmeta fm-show-sm">{cols[0] ? answerDisplay(cols[0], r.answers[cols[0].id], labels).slice(0, 60) : ''}</span>
                    </Link>
                  </th>
                  {cols.map((q) => (
                    <td key={q.id} className="fm-hide-sm fm-cell">
                      {answerDisplay(q, r.answers[q.id], labels).slice(0, 120)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="fm-pager" aria-label={t('pages')}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={filters.page <= 1} onClick={() => go({ page: filters.page - 1 })}>
            {t('prev')}
          </button>
          <span>{t('pageOf', { page: filters.page, pages })}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={filters.page >= pages} onClick={() => go({ page: filters.page + 1 })}>
            {t('next')}
          </button>
        </nav>
      )}
      <ConfirmDialog open={confirm} title={t('deleteTitle', { n: selected.length })} body={t('deleteBody')} confirmLabel={t('delete')} cancelLabel={t('cancel')} danger busy={busy} onConfirm={() => void remove()} onCancel={() => setConfirm(false)} />
    </div>
  );
}
