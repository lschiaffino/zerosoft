'use client';

import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import type { DashboardSummary, DashboardWidget } from '@/lib/track-dashboards';
import type { InsightResult } from '@/lib/track-planning-core';
import type { InsightQuery } from '@/lib/track-planning-schema';
import { api, fmtWhen, LoadingRows, Modal } from './shared';
import { InsightView } from './Insights';

/** Dashboards del workspace y personales. */
export function DashboardsList() {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [rows, setRows] = useState<DashboardSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const wantsNew = sp.get('new') === '1';
  useEffect(() => {
    if (wantsNew) setCreating(true);
  }, [wantsNew]);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'workspace' | 'personal'>('workspace');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ rows: DashboardSummary[] }>('/api/track/dashboards');
    setFailed(!res.ok);
    setRows(res.ok ? res.data.rows : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return;
    const res = await api<{ id: string }>('/api/track/dashboards', 'POST', { name: name.trim(), visibility });
    if (!res.ok) return setError(t('common.saveError'));
    router.push(`/app/track/dashboards/${res.data.id}`);
  };

  return (
    <>
      <div className="tp-toolbar">
        <button type="button" className="btn btn-sm btn-primary tp-toolbar-end" onClick={() => setCreating(true)} data-testid="tp-new-dashboard">
          {t('dashboards.new')}
        </button>
      </div>
      {rows === null ? (
        <LoadingRows />
      ) : failed ? (
        <EmptyState
          quiet
          title={t('common.loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('dashboards.emptyTitle')}
          body={t('dashboards.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              {t('dashboards.new')}
            </button>
          }
          secondary={<Link href="/app/track/insights">{t('dashboards.fromInsights')}</Link>}
        />
      ) : (
        <div className="table-wrap">
          <table className="table" data-testid="tp-dashboards">
            <caption className="sr-only">{t('dashboards.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('dashboards.nameLabel')}</th>
                <th scope="col">{t('dashboards.visibility')}</th>
                <th scope="col" className="num">{t('dashboards.widgets')}</th>
                <th scope="col">{t('dashboards.owner')}</th>
                <th scope="col">{t('dashboards.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/app/track/dashboards/${d.id}`} className="cell-link">
                      {d.name}
                    </Link>
                  </td>
                  <td data-label={t('dashboards.visibility')}>{t(`dashboards.${d.visibility}`)}</td>
                  <td className="num" data-label={t('dashboards.widgets')}>
                    {d.widget_count}
                  </td>
                  <td data-label={t('dashboards.owner')}>{d.user_name ?? ''}</td>
                  <td data-label={t('dashboards.updated')}>{fmtWhen(d.updated_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={creating}
        title={t('dashboards.new')}
        onClose={() => setCreating(false)}
        testId="tp-new-dashboard-modal"
        footer={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="tp-new-dashboard-form" className="btn btn-sm btn-primary" disabled={!name.trim()}>
              {t('dashboards.create')}
            </button>
          </>
        }
      >
        <form id="tp-new-dashboard-form" className="ui-fields" onSubmit={create}>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <div className="ui-field">
            <label className="label" htmlFor="tp-dash-name">
              {t('dashboards.nameLabel')}
            </label>
            <input id="tp-dash-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus required />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="tp-dash-vis">
              {t('dashboards.visibility')}
            </label>
            <select id="tp-dash-vis" className="select" value={visibility} onChange={(e) => setVisibility(e.target.value as 'workspace')}>
              <option value="workspace">{t('dashboards.workspace')}</option>
              <option value="personal">{t('dashboards.personal')}</option>
            </select>
            <p className="ui-help">{t('dashboards.visibilityHelp')}</p>
          </div>
        </form>
      </Modal>
    </>
  );
}

type WidgetWithResult = DashboardWidget & { result: InsightResult | null };

function insightHref(q: InsightQuery): string {
  const p = new URLSearchParams();
  if (q.measure !== 'count') p.set('measure', q.measure);
  if (q.slice !== 'status_type') p.set('slice', q.slice);
  if (q.segment !== 'none') p.set('segment', q.segment);
  if (q.interval !== 'week') p.set('interval', q.interval);
  if (q.filters.teamIds?.length) p.set('team', q.filters.teamIds.join(','));
  if (q.filters.planIds?.length) p.set('plan', q.filters.planIds.join(','));
  if (q.filters.labelIds?.length) p.set('label', q.filters.labelIds.join(','));
  if (q.filters.createdAfter) p.set('from', q.filters.createdAfter);
  if (q.filters.createdBefore) p.set('to', q.filters.createdBefore);
  return `/app/track/insights${p.toString() ? `?${p}` : ''}`;
}

/** Un dashboard: widgets de insights con los filtros del dashboard; renombrar, ordenar, borrar. */
export function DashboardPage({ dashboardId }: { dashboardId: string }) {
  const t = useTranslations('trackPlanning');
  const router = useRouter();
  const [data, setData] = useState<{ dashboard: DashboardSummary; widgets: WidgetWithResult[]; canDelete: boolean } | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [name, setName] = useState('');
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [confirm, setConfirm] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ dashboard: DashboardSummary; widgets: WidgetWithResult[]; canDelete: boolean }>(`/api/track/dashboards/${dashboardId}`);
    if (res.status === 404) return setState('missing');
    if (!res.ok) return setState('error');
    setData(res.data);
    setName(res.data.dashboard.name);
    setState('ok');
  }, [dashboardId]);
  useEffect(() => {
    void load();
    void api<{ teams: Array<{ id: string; name: string }> }>('/api/track/plans?meta=only').then((r) => r.ok && setTeams(r.data.teams));
  }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    await api(`/api/track/dashboards/${dashboardId}`, 'PATCH', body);
    await load();
  };
  const widget = async (id: string, method: 'PATCH' | 'DELETE', body?: Record<string, unknown>) => {
    await api(`/api/track/dashboard-widgets/${id}`, method, body);
    await load();
  };

  if (state === 'loading') return <LoadingRows rows={5} />;
  if (state === 'missing') return <EmptyState title={t('dashboards.notFound')} action={{ label: t('dashboards.back'), href: '/app/track/dashboards' }} />;
  if (state === 'error' || !data)
    return (
      <EmptyState
        title={t('common.loadError')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        }
      />
    );
  const d = data.dashboard;
  const enter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      setName(d.name);
      (e.target as HTMLInputElement).blur();
    }
  };
  return (
    <div className="tp-dashboard" data-testid="tp-dashboard-page">
      <nav className="tp-crumbs" aria-label={t('dashboards.title')}>
        <Link href="/app/track/dashboards">{t('dashboards.title')}</Link>
        <span aria-hidden="true">›</span>
        <span>{d.name}</span>
      </nav>
      <input
        className="tp-title-input"
        aria-label={t('dashboards.nameLabel')}
        value={name}
        maxLength={200}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() && name.trim() !== d.name ? void patch({ name: name.trim() }) : setName(d.name))}
        onKeyDown={enter}
        data-testid="tp-dashboard-name"
      />
      <div className="tp-toolbar" role="toolbar" aria-label={t('dashboards.filters')}>
        <label className="sr-only" htmlFor="tp-dash-team">
          {t('insights.team')}
        </label>
        <select id="tp-dash-team" className="select" value={d.filters.teamIds?.[0] ?? ''} onChange={(e) => void patch({ filters: { ...d.filters, teamIds: e.target.value ? [e.target.value] : undefined } })}>
          <option value="">{t('dashboards.allTeams')}</option>
          {teams.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="tp-dash-from">
          {t('insights.createdFrom')}
        </label>
        <input id="tp-dash-from" type="date" className="input tp-date-input" value={d.filters.createdAfter ?? ''} onChange={(e) => void patch({ filters: { ...d.filters, createdAfter: e.target.value || undefined } })} />
        <label className="sr-only" htmlFor="tp-dash-vis2">
          {t('dashboards.visibility')}
        </label>
        <select id="tp-dash-vis2" className="select" value={d.visibility} onChange={(e) => void patch({ visibility: e.target.value })}>
          <option value="workspace">{t('dashboards.workspace')}</option>
          <option value="personal">{t('dashboards.personal')}</option>
        </select>
        <span className="tp-toolbar-end" />
        <button
          type="button"
          className="btn btn-sm"
          aria-busy={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        >
          {t('dashboards.refresh')}
        </button>
        <Link href="/app/track/insights" className="btn btn-sm btn-primary">
          {t('dashboards.addWidget')}
        </Link>
        {data.canDelete && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)} data-testid="tp-dashboard-delete">
            {t('common.delete')}
          </button>
        )}
      </div>

      {data.widgets.length === 0 ? (
        <EmptyState quiet title={t('dashboards.noWidgets')} body={t('dashboards.noWidgetsBody')} action={{ label: t('dashboards.addWidget'), href: '/app/track/insights' }} />
      ) : (
        <div className="tp-widgets" data-testid="tp-widgets">
          {data.widgets.map((w, i) => (
            <section key={w.id} className={`tp-card tp-widget tp-widget-${w.width}`} aria-label={w.title || t('dashboards.widget')}>
              <div className="tp-card-head">
                <h3 className="tp-card-title">{w.title || t(`insights.measures.${w.query.measure}`)}</h3>
                <WidgetMenu
                  widget={w}
                  first={i === 0}
                  last={i === data.widgets.length - 1}
                  onPatch={(b) => void widget(w.id, 'PATCH', b)}
                  onDelete={() => void widget(w.id, 'DELETE')}
                />
              </div>
              {w.result ? <InsightView result={w.result} kind={w.kind} /> : <p className="ui-error">{t('common.loadError')}</p>}
              <Link href={insightHref(w.query)} className="tp-widget-link">
                {t('dashboards.openInInsights')}
              </Link>
            </section>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={t('dashboards.deleteTitle', { name: d.name })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={async () => {
          await api(`/api/track/dashboards/${dashboardId}`, 'DELETE');
          setConfirm(false);
          router.push('/app/track/dashboards');
        }}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

function WidgetMenu({
  widget,
  first,
  last,
  onPatch,
  onDelete,
}: {
  widget: DashboardWidget;
  first: boolean;
  last: boolean;
  onPatch: (b: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const t = useTranslations('trackPlanning');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(widget.title);
  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)} aria-label={t('dashboards.editWidget', { name: widget.title })}>
        {t('common.edit')}
      </button>
      <Modal
        open={open}
        title={t('dashboards.editWidgetTitle')}
        onClose={() => setOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              {t('dashboards.removeWidget')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                setOpen(false);
                onPatch({ title });
              }}
            >
              {t('common.save')}
            </button>
          </>
        }
      >
        <div className="ui-fields">
          <div className="ui-field">
            <label className="label" htmlFor={`tp-w-title-${widget.id}`}>
              {t('dashboards.widgetTitle')}
            </label>
            <input id={`tp-w-title-${widget.id}`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`tp-w-kind-${widget.id}`}>
              {t('dashboards.widgetKind')}
            </label>
            <select id={`tp-w-kind-${widget.id}`} className="select" value={widget.kind} onChange={(e) => onPatch({ kind: e.target.value })}>
              {(['chart', 'table', 'metric'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`dashboards.kinds.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="tp-form-actions">
            <button type="button" className="btn btn-sm" onClick={() => onPatch({ width: widget.width === 2 ? 1 : 2 })}>
              {widget.width === 2 ? t('dashboards.narrow') : t('dashboards.wide')}
            </button>
            <button type="button" className="btn btn-sm" disabled={first} onClick={() => onPatch({ move: 'up' })}>
              {t('dashboards.moveUp')}
            </button>
            <button type="button" className="btn btn-sm" disabled={last} onClick={() => onPatch({ move: 'down' })}>
              {t('dashboards.moveDown')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
