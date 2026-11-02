'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { SUBSCRIPTION_DAYS, type SubscriptionSchedule } from '@/lib/analytics/subscriptions-core';
import { ApiError, api, apiErrorText, notifyChanged } from './client';

export interface SubscriptionRow {
  id: string;
  name: string;
  insightId: string | null;
  dashboardId: string | null;
  insightIds: string[];
  recipients: string[];
  message: string;
  schedule: SubscriptionSchedule;
  enabled: boolean;
  nextAt: number | null;
  lastSentAt: number | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
}

type Named = { id: string; name: string };
type Board = Named & { insightIds: string[] };

const DEFAULT_SCHEDULE: SubscriptionSchedule = { frequency: 'weekly', interval: 1, hour: 9, weekdays: [1] };

/** Crear o editar una suscripción. */
export function SubscribeDialog({
  open,
  onClose,
  projectId,
  insights,
  dashboards,
  target,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  insights: Named[];
  dashboards: Board[];
  target?: { insightId?: string; dashboardId?: string };
  initial?: SubscriptionRow | null;
  onSaved?: (s: SubscriptionRow) => void;
}) {
  const t = useTranslations('analytics.subscriptions');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const [emails, setEmails] = useState('');
  const [message, setMessage] = useState('');
  const [schedule, setSchedule] = useState<SubscriptionSchedule>(DEFAULT_SCHEDULE);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultPick = target?.insightId ? `i:${target.insightId}` : target?.dashboardId ? `d:${target.dashboardId}` : '';
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setPick(initial ? (initial.insightId ? `i:${initial.insightId}` : `d:${initial.dashboardId}`) : defaultPick);
      setName(initial?.name ?? '');
      setEmails(initial?.recipients.join(', ') ?? '');
      setMessage(initial?.message ?? '');
      setSchedule(initial?.schedule ?? DEFAULT_SCHEDULE);
      setPicked(initial?.insightIds ?? []);
      setQuery('');
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const board = pick.startsWith('d:') ? dashboards.find((x) => x.id === pick.slice(2)) : undefined;
  const pickedInsight = pick.startsWith('i:') ? insights.find((x) => x.id === pick.slice(2)) : undefined;
  const boardInsights = useMemo(() => (board ? board.insightIds.map((x) => insights.find((i) => i.id === x)).filter((x): x is Named => Boolean(x)) : []), [board, insights]);
  // Un tablero nuevo arranca con los primeros 20.
  useEffect(() => {
    if (board && !initial) setPicked(board.insightIds.slice(0, 20));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id]);
  const shown = boardInsights.filter((i) => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase()));

  const save = async () => {
    const recipients = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const finalName = name.trim() || pickedInsight?.name || board?.name || '';
    if (!recipients.length) {
      setError(t('needRecipients'));
      return;
    }
    if (!pick) {
      setError(t('needTarget'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { name: finalName, recipients, message, schedule, locale, ...(board ? { insightIds: picked } : {}) };
      const r = initial
        ? await api<{ subscription: SubscriptionRow }>(`/api/analytics/subscriptions/${initial.id}`, { method: 'PATCH', body })
        : await api<{ subscription: SubscriptionRow }>('/api/analytics/subscriptions', {
            body: { ...body, projectId, insightId: pick.startsWith('i:') ? pick.slice(2) : null, dashboardId: pick.startsWith('d:') ? pick.slice(2) : null },
          });
      notifyChanged();
      onSaved?.(r.subscription);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_input' ? t('invalidInput') : apiErrorText(err, tc));
    } finally {
      setBusy(false);
    }
  };

  const set = (p: Partial<SubscriptionSchedule>) => setSchedule((s) => ({ ...s, ...p }));
  const monthly = schedule.frequency === 'monthly';
  const byOrdinal = monthly && Boolean(schedule.ordinal);
  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={`${id}-t`}>
              {initial ? t('editTitle') : t('newTitle')}
            </h2>
          </div>
          <div className="ui-modal-body ui-fields">
            {!initial && !target && (
              <label className="ui-field">
                <span className="label">{t('what')}</span>
                <select className="select" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">{t('choose')}</option>
                  {dashboards.length > 0 && (
                    <optgroup label={t('dashboards')}>
                      {dashboards.map((d) => (
                        <option key={d.id} value={`d:${d.id}`}>
                          {d.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {insights.length > 0 && (
                    <optgroup label={t('insights')}>
                      {insights.map((i) => (
                        <option key={i.id} value={`i:${i.id}`}>
                          {i.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            )}
            <label className="ui-field">
              <span className="label">{t('name')}</span>
              <input className="input" maxLength={200} value={name} placeholder={pickedInsight?.name ?? board?.name ?? ''} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="ui-field">
              <span className="label">{t('recipients')}</span>
              <textarea className="textarea" rows={2} value={emails} placeholder="ana@acme.com, bob@acme.com" onChange={(e) => setEmails(e.target.value)} />
              <span className="ui-help">{t('recipientsHelp')}</span>
            </label>
            <label className="ui-field">
              <span className="label">{t('message')}</span>
              <textarea className="textarea" rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <div className="an-row an-wrap">
              <label className="ui-field an-inline-field">
                <span className="label">{t('frequency')}</span>
                <select className="select" value={schedule.frequency} onChange={(e) => set({ frequency: e.target.value as SubscriptionSchedule['frequency'] })}>
                  <option value="daily">{t('daily')}</option>
                  <option value="weekly">{t('weekly')}</option>
                  <option value="monthly">{t('monthly')}</option>
                </select>
              </label>
              <label className="ui-field an-inline-field">
                <span className="label">{t('every')}</span>
                <input className="input an-num-input" type="number" min={1} max={52} value={schedule.interval} onChange={(e) => set({ interval: Math.min(52, Math.max(1, Number(e.target.value) || 1)) })} />
              </label>
              <label className="ui-field an-inline-field">
                <span className="label">{t('hour')}</span>
                <select className="select" value={schedule.hour} onChange={(e) => set({ hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {`${String(h).padStart(2, '0')}:00`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {schedule.frequency === 'weekly' && (
              <fieldset className="an-row an-wrap an-sub-days">
                <legend className="label">{t('onDays')}</legend>
                {SUBSCRIPTION_DAYS.map((d, i) => (
                  <label key={d} className="ui-check">
                    <input
                      type="checkbox"
                      checked={(schedule.weekdays ?? []).includes(i)}
                      onChange={(e) => {
                        const list = (schedule.weekdays ?? []).filter((x) => x !== i);
                        set({ weekdays: e.target.checked ? [...list, i].sort() : list });
                      }}
                    />{' '}
                    {t(`days.${d}`)}
                  </label>
                ))}
              </fieldset>
            )}
            {monthly && (
              <div className="an-row an-wrap">
                <label className="ui-field an-inline-field">
                  <span className="label">{t('monthRule')}</span>
                  <select className="select" value={byOrdinal ? 'ordinal' : 'day'} onChange={(e) => set(e.target.value === 'ordinal' ? { ordinal: 1, ordinalDay: 'mon', monthDay: null } : { ordinal: null, ordinalDay: null, monthDay: 1 })}>
                    <option value="day">{t('ruleDay')}</option>
                    <option value="ordinal">{t('ruleOrdinal')}</option>
                  </select>
                </label>
                {!byOrdinal && (
                  <label className="ui-field an-inline-field">
                    <span className="label">{t('dayOfMonth')}</span>
                    <input className="input an-num-input" type="number" min={1} max={31} value={schedule.monthDay ?? 1} onChange={(e) => set({ monthDay: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
                  </label>
                )}
                {byOrdinal && (
                  <>
                    <select className="select" aria-label={t('ordinal')} value={schedule.ordinal ?? 1} onChange={(e) => set({ ordinal: Number(e.target.value) as 1 | 2 | 3 | 4 | -1 })}>
                      {[1, 2, 3, 4, -1].map((n) => (
                        <option key={n} value={n}>
                          {t(`ordinals.${n === -1 ? 'last' : n}`)}
                        </option>
                      ))}
                    </select>
                    <select className="select" aria-label={t('ordinalDay')} value={schedule.ordinalDay ?? 'mon'} onChange={(e) => set({ ordinalDay: e.target.value as SubscriptionSchedule['ordinalDay'] })}>
                      {[...SUBSCRIPTION_DAYS, 'day', 'weekday'].map((d) => (
                        <option key={d} value={d}>
                          {t(`days.${d}`)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}
            {board && (
              <fieldset className="an-form-tight">
                <legend className="label">{t('pickInsights', { n: picked.length })}</legend>
                {boardInsights.length > 10 && <input className="input" aria-label={t('searchInsights')} placeholder={t('searchInsights')} value={query} onChange={(e) => setQuery(e.target.value)} />}
                {shown.map((i) => (
                  <label key={i.id} className="ui-check">
                    <input
                      type="checkbox"
                      checked={picked.includes(i.id)}
                      disabled={!picked.includes(i.id) && picked.length >= 20}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, i.id] : picked.filter((x) => x !== i.id))}
                    />{' '}
                    {i.name}
                  </label>
                ))}
              </fieldset>
            )}
            {error && (
              <p className="ui-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={onClose}>
              {tc('cancel')}
            </button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy} aria-busy={busy}>
              {tc('save')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

type Tab = 'all' | 'mine' | 'dashboard' | 'insight';
type Sort = 'created' | 'next' | 'name';

/** Todas las suscripciones del proyecto. */
export function SubscriptionsPage({ projectId, canManage, insights, dashboards }: { projectId: string; canManage: boolean; insights: Named[]; dashboards: Board[] }) {
  const t = useTranslations('analytics.subscriptions');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [me, setMe] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('created');
  const [editing, setEditing] = useState<SubscriptionRow | 'new' | null>(null);
  const [undo, setUndo] = useState<SubscriptionRow | null>(null);

  const load = () =>
    api<{ subscriptions: SubscriptionRow[]; me: string }>(`/api/analytics/subscriptions?project=${encodeURIComponent(projectId)}`)
      .then((r) => {
        setRows(r.subscriptions);
        setMe(r.me);
      })
      .catch((err) => setError(apiErrorText(err, tc)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = (rows ?? []).filter((r) => {
      if (tab === 'mine' && r.createdBy !== me) return false;
      if (tab === 'dashboard' && !r.dashboardId) return false;
      if (tab === 'insight' && !r.insightId) return false;
      return !term || r.name.toLowerCase().includes(term) || r.recipients.some((x) => x.includes(term));
    });
    if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'next') out.sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity));
    return out;
  }, [rows, tab, q, sort, me]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'subscription_disabled' ? t('testDisabled') : apiErrorText(err, tc));
    }
  };
  const remove = (r: SubscriptionRow) =>
    act(async () => {
      await api(`/api/analytics/subscriptions/${r.id}`, { method: 'DELETE' });
      setUndo(r);
      notifyChanged();
    });
  const restore = (r: SubscriptionRow) =>
    act(async () => {
      await api('/api/analytics/subscriptions', {
        body: { projectId, name: r.name, recipients: r.recipients, message: r.message, schedule: r.schedule, insightId: r.insightId, dashboardId: r.dashboardId, insightIds: r.insightIds, enabled: r.enabled, locale },
      });
      setUndo(null);
    });
  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : t('notScheduled'));

  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <button type="button" className="btn btn-primary" disabled={!insights.length && !dashboards.length} onClick={() => setEditing('new')}>
              {t('new')}
            </button>
          ) : undefined
        }
      />
      {!canManage && <p className="an-note">{t('adminsOnly')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="an-note" role="status">
          {notice}
        </p>
      )}
      {undo && (
        <p className="an-note" role="status">
          {t('deleted', { name: undo.name })}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void restore(undo)}>
            {t('undo')}
          </button>
        </p>
      )}
      {rows === null && !error && <span className="ui-skeleton ui-skeleton-block" />}
      {rows !== null && rows.length === 0 && (
        <EmptyState product="analytics" title={t('emptyTitle')} body={insights.length || dashboards.length ? t('emptyBody') : t('emptyBodyNothing')} action={insights.length || dashboards.length ? undefined : { label: t('newInsight'), href: '/app/analytics/insights/new' }} />
      )}
      {rows !== null && rows.length > 0 && (
        <>
          <div className="an-toolbar an-wrap">
            <div role="tablist" aria-label={t('filterBy')} className="an-row an-wrap">
              {(['all', 'mine', 'dashboard', 'insight'] as Tab[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn btn-sm ${tab === k ? '' : 'btn-ghost'}`} onClick={() => setTab(k)}>
                  {t(`tabs.${k}`)}
                </button>
              ))}
            </div>
            <input className="input an-filter-key" aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="select" aria-label={t('sort')} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="created">{t('sortCreated')}</option>
              <option value="next">{t('sortNext')}</option>
              <option value="name">{t('sortName')}</option>
            </select>
          </div>
          {list.length === 0 && <p className="an-empty-result">{t('noMatch')}</p>}
          {list.length > 0 && (
            <div className="table-wrap">
              <table className="table table-compact an-table an-subs-table" data-testid="an-subs-table">
                <thead>
                  <tr>
                    <th scope="col">{t('name')}</th>
                    <th scope="col">{t('recipients')}</th>
                    <th scope="col">{t('next')}</th>
                    {canManage && (
                      <th scope="col">
                        <span className="sr-only">{t('actions')}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <td className="an-break">
                        {r.name}
                        {!r.enabled && <span className="an-muted an-small"> · {t('disabled')}</span>}
                        {r.lastError && <span className="ui-error an-small"> · {t('lastFailed')}</span>}
                      </td>
                      <td className="an-break">{r.recipients.join(', ')}</td>
                      <td>{when(r.nextAt)}</td>
                      {canManage && (
                        <td className="an-td-action">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(r)} aria-label={t('editNamed', { name: r.name })}>
                            {t('edit')}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={!r.enabled} title={r.enabled ? undefined : t('testDisabled')} onClick={() => void act(() => api(`/api/analytics/subscriptions/${r.id}`, { method: 'PATCH', body: { test: true, locale } }), t('testSent'))}>
                            {t('test')}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(() => api(`/api/analytics/subscriptions/${r.id}`, { method: 'PATCH', body: { enabled: !r.enabled, locale } }))}>
                            {r.enabled ? t('disable') : t('enable')}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(r)} aria-label={t('deleteNamed', { name: r.name })}>
                            {tc('delete')}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <SubscribeDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        projectId={projectId}
        insights={insights}
        dashboards={dashboards}
        initial={editing && editing !== 'new' ? editing : null}
        onSaved={() => void load()}
      />
    </div>
  );
}

/** Confirmar la baja de un reporte. */
export function UnsubscribeButton({ token }: { token: string }) {
  const t = useTranslations('analytics.subscriptions');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const go = async () => {
    setState('busy');
    const res = await fetch('/api/analytics/sub-unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }).catch(() => null);
    setState(res?.ok ? 'done' : 'error');
  };
  return (
    <div className="an-share-unlock an-panel" data-testid="an-unsubscribe">
      <h1 className="an-h3 an-flush">{t('unsubscribeTitle')}</h1>
      {state === 'done' ? (
        <p role="status">{t('unsubscribed')}</p>
      ) : (
        <>
          <p className="an-note">{t('unsubscribeBody')}</p>
          {state === 'error' && (
            <p className="ui-error" role="alert">
              {t('unsubscribeError')}
            </p>
          )}
          <button type="button" className="btn btn-primary an-self-start" disabled={state === 'busy'} onClick={() => void go()}>
            {t('unsubscribeConfirm')}
          </button>
        </>
      )}
    </div>
  );
}
