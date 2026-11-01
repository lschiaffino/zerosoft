'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import LocalText from '@/components/ui/LocalText';
import { useMounted } from '@/components/ui/useMounted';
import type { ActionDto, ActionStep, AnnotationDto, EventDefinitionDto } from '@/lib/analytics/types';
import { apiErrorText, api, fmtNumber, fmtTime, notifyChanged } from './client';
import { EventInput, FilterList, cleanFilters, useProjectMeta } from './Filters';

/** Editor de una acción: nombre y pasos (cualquiera cuenta). */
export function ActionEditor({ projectId, action }: { projectId: string; action: ActionDto }) {
  const t = useTranslations('analytics.actions');
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const meta = useProjectMeta(projectId);
  const [name, setName] = useState(action.name);
  const [description, setDescription] = useState(action.description);
  const [steps, setSteps] = useState<ActionStep[]>(action.steps.length ? action.steps : [{ event: '$pageview', urlContains: null, filters: [] }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/analytics/actions/${action.id}`, {
        method: 'PATCH',
        body: { name, description, steps: steps.map((s) => ({ event: s.event.trim() || '*', urlContains: s.urlContains?.trim() || null, filters: cleanFilters(s.filters) })) },
      });
      setMsg({ ok: true, text: t('saved') });
      notifyChanged();
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: apiErrorText(err, tc) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        back={{ href: '/app/analytics/actions', label: t('title') }}
        title={action.name}
        description={action.description || undefined}
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setDeleting(true)}>
            {tc('delete')}
          </button>
        }
      />
      <form
        className="an-form an-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="ui-field">
          <span className="label">{t('name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </label>
        <label className="ui-field">
          <span className="label">{t('descriptionLabel')}</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
        </label>
        <p className="an-note">{t('stepsHelp')}</p>
        {steps.map((s, i) => (
          <fieldset key={i} className="an-series">
            <legend className="an-series-legend">{t('stepN', { n: i + 1 })}</legend>
            <div className="an-row an-wrap">
              <EventInput value={s.event} onChange={(event) => setSteps(steps.map((x, j) => (j === i ? { ...x, event } : x)))} meta={{ ...meta, actions: [] }} label={t('event')} />
              <input
                className="input an-event-input"
                aria-label={t('urlContains')}
                placeholder={t('urlContains')}
                value={s.urlContains ?? ''}
                onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, urlContains: e.target.value } : x)))}
                maxLength={300}
              />
              {steps.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                  {tc('remove')}
                </button>
              )}
            </div>
            <FilterList filters={s.filters} onChange={(filters) => setSteps(steps.map((x, j) => (j === i ? { ...x, filters } : x)))} meta={meta} types={['event']} />
          </fieldset>
        ))}
        <div className="an-row an-wrap">
          <button type="button" className="btn btn-sm" disabled={steps.length >= 10} title={steps.length >= 10 ? t('stepsMax') : undefined} onClick={() => setSteps([...steps, { event: '$autocapture', urlContains: null, filters: [] }])}>
            + {t('addStep')}
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {tc('save')}
          </button>
          <Link className="an-link" href={`/app/analytics/insights/new`}>
            {t('useHint')}
          </Link>
        </div>
        {msg && (
          <p className={msg.ok ? 'an-saved' : 'ui-error'} role={msg.ok ? 'status' : 'alert'}>
            {msg.text}
          </p>
        )}
      </form>
      <ConfirmDialog
        open={deleting}
        title={t('deleteTitle', { name: action.name })}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(`/api/analytics/actions/${action.id}`, { method: 'DELETE' });
            notifyChanged();
            router.replace('/app/analytics/actions');
          } catch {
            setBusy(false);
            setDeleting(false);
            setMsg({ ok: false, text: tc('error') });
          }
        }}
      />
    </div>
  );
}

/** Anotaciones del proyecto: fecha y texto. Se ven como marcas en los gráficos de tendencias. */
export function AnnotationsPage({ projectId, initial }: { projectId: string; initial: AnnotationDto[] }) {
  const t = useTranslations('analytics.annotations');
  const tc = useTranslations('analytics.common');
  const mounted = useMounted();
  const [items, setItems] = useState(initial);
  const [date, setDate] = useState('');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editContent, setEditContent] = useState('');
  const [deleting, setDeleting] = useState<AnnotationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
  const today = mounted ? new Date().toISOString().slice(0, 10) : '';

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ annotation: AnnotationDto }>('/api/analytics/annotations', { body: { projectId, date: date || today, content } });
      setItems((x) => [r.annotation, ...x]);
      setContent('');
    } catch (err) {
      setError(apiErrorText(err, tc));
    } finally {
      setBusy(false);
    }
  };
  const saveEdit = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/analytics/annotations/${id}`, { method: 'PATCH', body: { date: editDate, content: editContent } });
      setItems((x) => x.map((a) => (a.id === id ? { ...a, date: editDate, content: editContent } : a)));
      setEditing(null);
    } catch (err) {
      setError(apiErrorText(err, tc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-page ui-page an-page">
      <PageHeader title={t('title')} description={t('description')} />
      <form
        className="an-panel an-row an-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="input an-date-input" type="date" aria-label={t('date')} value={date || today} onChange={(e) => setDate(e.target.value)} required />
        <input className="input an-grow" aria-label={t('content')} placeholder={t('contentPlaceholder')} value={content} onChange={(e) => setContent(e.target.value)} maxLength={400} required />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {t('add')}
        </button>
      </form>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {sorted.length === 0 ? (
        <EmptyState product="analytics" title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <div className="table-wrap table-stack">
          <table className="table an-list" data-testid="an-list-annotations">
            <thead>
              <tr>
                <th scope="col">{t('date')}</th>
                <th scope="col">{t('content')}</th>
                <th scope="col" className="an-actions-col">
                  <span className="sr-only">{tc('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) =>
                editing === a.id ? (
                  <tr key={a.id}>
                    <td>
                      <input className="input an-date-input" type="date" aria-label={t('date')} value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                    </td>
                    <td>
                      <input
                        className="input"
                        aria-label={t('content')}
                        value={editContent}
                        maxLength={400}
                        autoFocus
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveEdit(a.id);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    </td>
                    <td className="an-actions table-stack-actions">
                      <button type="button" className="btn btn-sm" disabled={busy || !editContent.trim()} onClick={() => void saveEdit(a.id)}>
                        {tc('save')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                        {tc('cancel')}
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={a.id}>
                    <td className="an-mono an-nowrap" data-label={t('date')}>
                      {a.date}
                    </td>
                    <td className="an-wrap-cell" data-label={t('content')}>
                      {a.content}
                    </td>
                    <td className="an-actions table-stack-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`${tc('rename')}: ${a.content}`}
                        onClick={() => {
                          setEditing(a.id);
                          setEditDate(a.date);
                          setEditContent(a.content);
                        }}
                      >
                        {t('edit')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" aria-label={`${tc('delete')}: ${a.content}`} onClick={() => setDeleting(a)}>
                        {tc('delete')}
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteTitle')}
        body={deleting?.content ?? ''}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await api(`/api/analytics/annotations/${deleting.id}`, { method: 'DELETE' });
            setItems((x) => x.filter((a) => a.id !== deleting.id));
            setDeleting(null);
          } catch (err) {
            setError(apiErrorText(err, tc));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

/** Gestión de datos: los eventos del proyecto con descripción, verificado y oculto de los selectores. */
export function DataManagement({ projectId, initial }: { projectId: string; initial: EventDefinitionDto[] }) {
  const t = useTranslations('analytics.data');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const [items, setItems] = useState(initial);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const shown = items.filter((i) => i.event.toLowerCase().includes(q.trim().toLowerCase()));

  const save = async (e: EventDefinitionDto, patch: Partial<EventDefinitionDto>) => {
    const next = { ...e, ...patch };
    setItems((x) => x.map((i) => (i.event === e.event ? next : i)));
    setError(null);
    try {
      await api('/api/analytics/definitions', { method: 'PUT', body: { projectId, event: e.event, description: next.description, verified: next.verified, hidden: next.hidden } });
      notifyChanged();
    } catch (err) {
      setError(apiErrorText(err, tc));
      setItems((x) => x.map((i) => (i.event === e.event ? e : i)));
    }
  };

  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <a className="btn" href={`/api/analytics/export?project=${encodeURIComponent(projectId)}`} download>
            {t('exportEvents')}
          </a>
        }
      />
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState product="analytics" title={t('emptyTitle')} body={t('emptyBody')} action={{ label: t('install'), href: '/app/analytics/settings' }} />
      ) : (
        <>
          <input className="input an-search" type="search" aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="table-wrap table-stack">
            <table className="table an-list" data-testid="an-list-data">
              <thead>
                <tr>
                  <th scope="col">{t('event')}</th>
                  <th scope="col">{t('descriptionHead')}</th>
                  <th scope="col" className="num">
                    {t('volume')}
                  </th>
                  <th scope="col">{t('lastSeen')}</th>
                  <th scope="col">{t('verified')}</th>
                  <th scope="col">{t('hidden')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.event}>
                    <td className="an-mono an-wrap-cell">{e.event}</td>
                    <td data-label={t('descriptionHead')}>
                      <input
                        className="input"
                        aria-label={t('descriptionFor', { event: e.event })}
                        defaultValue={e.description}
                        maxLength={500}
                        placeholder={t('descriptionPlaceholder')}
                        onBlur={(ev) => ev.target.value !== e.description && void save(e, { description: ev.target.value })}
                      />
                    </td>
                    <td className="num" data-label={t('volume')}>
                      {fmtNumber(e.count30d, locale)}
                    </td>
                    <td className="an-nowrap" data-label={t('lastSeen')}>
                      {e.lastSeen ? <LocalText>{fmtTime(e.lastSeen, locale)}</LocalText> : '–'}
                    </td>
                    <td data-label={t('verified')}>
                      <input type="checkbox" aria-label={t('verifiedFor', { event: e.event })} checked={e.verified} onChange={(ev) => void save(e, { verified: ev.target.checked })} />
                    </td>
                    <td data-label={t('hidden')}>
                      <input type="checkbox" aria-label={t('hiddenFor', { event: e.event })} checked={e.hidden} onChange={(ev) => void save(e, { hidden: ev.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Grupos del proyecto (empresas, equipos): lo que llegó con zs.group(). */
export function GroupsPage({ groups }: { groups: Array<{ type: string; key: string; properties: Record<string, unknown>; updatedAt: number }> }) {
  const t = useTranslations('analytics.groups');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const types = [...new Set(groups.map((g) => g.type))].sort();
  const [type, setType] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = groups.filter((g) => (!type || g.type === type) && (!needle || g.key.toLowerCase().includes(needle) || JSON.stringify(g.properties).toLowerCase().includes(needle)));
  return (
    <div className="app-page ui-page an-page">
      <PageHeader title={t('title')} description={t('description')} />
      {groups.length === 0 ? (
        <EmptyState product="analytics" title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <>
          <div className="an-toolbar">
            <input className="input an-search" type="search" aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="select" aria-label={t('type')} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{t('allTypes')}</option>
              {types.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          {shown.length === 0 ? (
            <p className="an-empty-result">{t('noMatch')}</p>
          ) : (
            <div className="table-wrap table-stack">
              <table className="table an-list" data-testid="an-list-groups">
                <thead>
                  <tr>
                    <th scope="col">{t('key')}</th>
                    <th scope="col">{t('type')}</th>
                    <th scope="col">{t('properties')}</th>
                    <th scope="col">{t('updated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((g) => (
                    <tr key={`${g.type}:${g.key}`}>
                      <td className="an-mono an-wrap-cell">{g.key}</td>
                      <td data-label={t('type')}>{g.type}</td>
                      <td className="an-wrap-cell an-small" data-label={t('properties')}>
                        {Object.entries(g.properties)
                          .slice(0, 6)
                          .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
                          .join(' · ') || '–'}
                      </td>
                      <td className="an-nowrap" data-label={t('updated')}>
                        <LocalText>{fmtTime(g.updatedAt, locale)}</LocalText>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
