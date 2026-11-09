'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { applyDashboard, layoutOf, moveInLayout } from '@/lib/analytics/dashboard-core';
import { AUTO_REFRESH_MINUTES, type DashboardDto, type DashboardSettings, type DashboardTile, type InsightDto, type InsightResult } from '@/lib/analytics/types';
import DashboardText from './DashboardText';
import { FilterList, cleanFilters, useProjectMeta, type ProjectMeta } from './Filters';
import { ShareDialog } from './InsightPanels';
import { SubscribeDialog } from './Subscriptions';
import { DateRangePicker } from './RangeSelect';
import { ApiError, apiErrorText, api, notifyChanged, runQuery } from './client';
import InsightResultView from './InsightResultView';
import NameDialog from './NameDialog';

/** Opciones de una tarjeta: tamaño, fechas, filtros, vista y pasarla a otro tablero. */
function TileOptions({
  open,
  onClose,
  insight,
  tile,
  onChange,
  others,
  onTransfer,
  meta,
}: {
  open: boolean;
  onClose: () => void;
  insight: InsightDto;
  tile: DashboardTile;
  onChange: (t: DashboardTile) => void;
  others: Array<{ id: string; name: string }>;
  onTransfer: (targetId: string, move: boolean) => Promise<boolean>;
  meta: ProjectMeta;
}) {
  const t = useTranslations('analytics.dashboards');
  const te = useTranslations('analytics.editor');
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const q = insight.query;
  const hasRange = q.kind !== 'sql' && q.kind !== 'retention';
  const hasInterval = q.kind === 'trends' || q.kind === 'stickiness' || q.kind === 'lifecycle' || q.kind === 'funnel';
  const o = tile.options ?? {};
  const setOption = (p: Partial<NonNullable<DashboardTile['options']>>) => onChange({ ...tile, options: { ...o, ...p } });
  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-label={t('tileOptionsOf', { name: insight.name })}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{t('tileOptionsOf', { name: insight.name })}</h2>
          </div>
          <div className="ui-modal-body ui-fields">
            <label className="ui-field">
              <span className="label">{t('tileSize')}</span>
              <select className="select" value={tile.size ?? 'm'} onChange={(e) => onChange({ ...tile, size: e.target.value as 's' | 'm' | 'l' })}>
                {(['s', 'm', 'l'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`sizes.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-check">
              <input type="checkbox" checked={Boolean(tile.ignoreFilters)} onChange={(e) => onChange({ ...tile, ignoreFilters: e.target.checked })} /> {t('ignoreFilters')}
            </label>
            {hasRange && (
              <>
                <label className="ui-check">
                  <input type="checkbox" checked={Boolean(tile.dateRange)} onChange={(e) => onChange({ ...tile, dateRange: e.target.checked ? { from: '-30d' } : null })} /> {t('tileRange')}
                </label>
                {tile.dateRange && <DateRangePicker value={tile.dateRange} onChange={(dateRange) => onChange({ ...tile, dateRange })} />}
              </>
            )}
            {hasInterval && (
              <label className="ui-field">
                <span className="label">{t('tileInterval')}</span>
                <select className="select" value={tile.interval ?? ''} onChange={(e) => onChange({ ...tile, interval: (e.target.value || null) as DashboardTile['interval'] })}>
                  <option value="">{t('intervalInsight')}</option>
                  {(['hour', 'day', 'week', 'month'] as const).map((iv) => (
                    <option key={iv} value={iv}>
                      {te(`intervals.${iv}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {q.kind !== 'sql' && (
              <div className="an-dash-filters">
                <span className="label">{t('tileFilters')}</span>
                <FilterList filters={tile.filters ?? []} onChange={(filters) => onChange({ ...tile, filters })} meta={meta} />
              </div>
            )}
            {q.kind === 'trends' && (
              <>
                <label className="ui-field">
                  <span className="label">{t('tileSmoothing')}</span>
                  <select className="select" value={o.smoothing ?? 0} onChange={(e) => setOption({ smoothing: Number(e.target.value) as 0 | 7 | 28 })}>
                    <option value={0}>{te('smoothingNone')}</option>
                    <option value={7}>{te('smoothingN', { n: 7 })}</option>
                    <option value={28}>{te('smoothingN', { n: 28 })}</option>
                  </select>
                </label>
                <label className="ui-check">
                  <input type="checkbox" checked={Boolean(o.showValues)} onChange={(e) => setOption({ showValues: e.target.checked })} /> {t('tileValues')}
                </label>
                <label className="ui-check">
                  <input type="checkbox" checked={Boolean(o.hideLegend)} onChange={(e) => setOption({ hideLegend: e.target.checked })} /> {t('tileLegend')}
                </label>
              </>
            )}
            <TransferSelect label={t('copyTo')} others={others} onPick={async (id) => { if (await onTransfer(id, false)) setCopied(true); }} />
            <TransferSelect label={t('moveTo')} others={others} onPick={async (id) => { if (await onTransfer(id, true)) onClose(); }} />
            {copied && <p className="ui-help" role="status">{t('copied')}</p>}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>
              {t('close')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

function TransferSelect({ label, others, onPick }: { label: string; others: Array<{ id: string; name: string }>; onPick: (id: string) => void }) {
  const t = useTranslations('analytics.dashboards');
  return (
    <label className="ui-field">
      <span className="label">{label}</span>
      <select className="select" value="" disabled={!others.length} onChange={(e) => e.target.value && onPick(e.target.value)}>
        <option value="">{others.length ? t('chooseDashboard') : t('noOtherDashboards')}</option>
        {others.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Tile({
  projectId,
  insight,
  onRemove,
  onMove,
  settings,
  tile,
  onTile,
  others,
  onTransfer,
  refreshKey,
  annotations,
  meta,
}: {
  projectId: string;
  insight: InsightDto;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  settings: DashboardSettings;
  tile: DashboardTile;
  onTile: (t: DashboardTile) => void;
  others: Array<{ id: string; name: string }>;
  onTransfer: (targetId: string, move: boolean) => Promise<boolean>;
  refreshKey: number;
  annotations: Array<{ date: string; content: string }>;
  meta: ProjectMeta;
}) {
  const t = useTranslations('analytics.dashboards');
  const te = useTranslations('analytics.editor');
  const locale = useLocale();
  const [result, setResult] = useState<InsightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computedAt, setComputedAt] = useState<number | null>(null);
  const [own, setOwn] = useState(0);
  const [options, setOptions] = useState(false);
  const query = applyDashboard(insight.query, settings, tile);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    const c = new AbortController();
    setError(null);
    runQuery(projectId, query, c.signal)
      .then((r) => {
        setResult(r);
        setComputedAt(Date.now());
      })
      .catch((err) => {
        if (!c.signal.aborted) setError(err instanceof ApiError && te.has(`errors.${err.code}`) ? te(`errors.${err.code}`) : te('errors.request_failed'));
      });
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, queryKey, te, refreshKey, own]);
  return (
    <article className={`an-tile an-panel is-${tile.size ?? 'm'}`} aria-label={insight.name}>
      <header className="an-tile-head">
        <Link href={`/app/pulse/insights/${insight.id}`} className="an-tile-title">
          {insight.name}
        </Link>
        <span className="an-muted an-small an-hide-sm">{te(`kinds.${insight.kind}`)}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove(-1)} aria-label={t('moveUp', { name: insight.name })} title={t('moveUp', { name: insight.name })}>
          ↑
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove(1)} aria-label={t('moveDown', { name: insight.name })} title={t('moveDown', { name: insight.name })}>
          ↓
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOptions(true)} aria-label={t('tileOptionsOf', { name: insight.name })}>
          {t('tileOptions')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={t('removeTile', { name: insight.name })}>
          {t('remove')}
        </button>
      </header>
      {tile.ignoreFilters && <span className="an-tile-badge">{t('ignoresBadge')}</span>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {!result && !error && <span className="ui-skeleton ui-skeleton-block" />}
      {result && <InsightResultView result={result} display={insight.query.kind === 'trends' ? insight.query.display : 'line'} annotations={annotations} />}
      {computedAt && (
        <footer className="an-tile-foot">
          <span>{t('computedAt', { time: new Date(computedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOwn((k) => k + 1)} aria-label={t('refreshTile', { name: insight.name })}>
            {t('refresh')}
          </button>
        </footer>
      )}
      <TileOptions open={options} onClose={() => setOptions(false)} insight={insight} tile={tile} onChange={onTile} others={others} onTransfer={onTransfer} meta={meta} />
    </article>
  );
}

/** Tarjeta de texto: Markdown, se edita en un cuadro. */
function TextTile({
  body,
  onEdit,
  onDelete,
  onMove,
  others,
  onTransfer,
}: {
  body: string;
  onEdit: (body: string) => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
  others: Array<{ id: string; name: string }>;
  onTransfer: (targetId: string, move: boolean) => Promise<boolean>;
}) {
  const t = useTranslations('analytics.dashboards');
  const [editing, setEditing] = useState(false);
  return (
    <article className="an-tile an-panel is-m" aria-label={t('textTitle')}>
      <header className="an-tile-head">
        <span className="an-tile-title an-muted">{t('textTitle')}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove(-1)} aria-label={t('moveUpText')} title={t('moveUpText')}>
          ↑
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove(1)} aria-label={t('moveDownText')} title={t('moveDownText')}>
          ↓
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          {t('editText')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete}>
          {t('deleteText')}
        </button>
      </header>
      <DashboardText body={body} />
      <TextDialog open={editing} initial={body} onClose={() => setEditing(false)} onSave={(v) => { onEdit(v); setEditing(false); }} others={others} onTransfer={onTransfer} />
    </article>
  );
}

function TextDialog({
  open,
  initial,
  onClose,
  onSave,
  others = [],
  onTransfer,
}: {
  open: boolean;
  initial: string;
  onClose: () => void;
  onSave: (body: string) => void;
  others?: Array<{ id: string; name: string }>;
  onTransfer?: (targetId: string, move: boolean) => Promise<boolean>;
}) {
  const t = useTranslations('analytics.dashboards');
  const tc = useTranslations('analytics.common');
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setValue(initial);
      d.showModal();
    }
    if (!open && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-label={t('textTitle')}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onSave(value.trim());
          }}
        >
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{t('textTitle')}</h2>
          </div>
          <div className="ui-modal-body ui-fields">
            <label className="ui-field">
              <span className="label">{t('textLabel')}</span>
              <textarea className="textarea" rows={8} maxLength={5000} value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            {onTransfer && (
              <>
                <TransferSelect label={t('copyTo')} others={others} onPick={(id) => void onTransfer(id, false)} />
                <TransferSelect label={t('moveTo')} others={others} onPick={async (id) => { if (await onTransfer(id, true)) onClose(); }} />
              </>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" onClick={onClose}>
              {tc('cancel')}
            </button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={!value.trim()}>
              {tc('save')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** Un tablero: sus insights en grilla, renombrar, sumar o sacar insights y borrar. */
export default function DashboardView({
  projectId,
  dashboard,
  insights,
  allInsights,
  canShare = false,
  annotations = [],
  cohorts = [],
  otherDashboards = [],
  locked = false,
}: {
  projectId: string;
  dashboard: DashboardDto;
  insights: InsightDto[];
  allInsights: Array<{ id: string; name: string }>;
  canShare?: boolean;
  annotations?: Array<{ date: string; content: string }>;
  cohorts?: Array<{ id: string; name: string }>;
  otherDashboards?: Array<{ id: string; name: string }>;
  /** Está en un link público y quien mira no es admin: no se puede cambiar. */
  locked?: boolean;
}) {
  const t = useTranslations('analytics.dashboards');
  const te = useTranslations('analytics.editor');
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const meta = useProjectMeta(projectId);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errorText = (err: unknown) => (err instanceof ApiError && err.code === 'shared_admin_only' ? t('sharedAdminOnly') : apiErrorText(err, tc));
  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/analytics/dashboards/${dashboard.id}`, { method: 'PATCH', body });
      notifyChanged();
      router.refresh();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const available = allInsights.filter((i) => !dashboard.insightIds.includes(i.id));
  const [settings, setSettings] = useState<DashboardSettings>(dashboard.settings);
  const [addingText, setAddingText] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Lo que cambia otra pestaña o una acción que recarga manda sobre lo local.
  const serverSettings = JSON.stringify(dashboard.settings);
  useEffect(() => {
    setSettings(JSON.parse(serverSettings) as DashboardSettings);
  }, [serverSettings]);
  const range = settings.dateRange ?? null;

  /** Guarda al toque en pantalla; a la base, medio segundo después del último cambio. */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (next: DashboardSettings) => {
    setSettings(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const clean: DashboardSettings = { ...next, filters: cleanFilters(next.filters) };
      api(`/api/analytics/dashboards/${dashboard.id}`, { method: 'PATCH', body: { settings: clean } }).catch((err) => {
        setError(errorText(err));
        // Lo que no se guardó no se queda en pantalla como si se hubiera guardado.
        setSettings(JSON.parse(serverSettings) as DashboardSettings);
      });
    }, 500);
  };
  const setTile = (id: string, tile: DashboardTile) => save({ ...settings, tiles: { ...settings.tiles, [id]: { ...tile, filters: tile.filters } } });

  // Actualizar solo: cada tanto y únicamente con la pestaña a la vista.
  const autoMin = settings.autoRefreshMin ?? 0;
  useEffect(() => {
    if (!autoMin) return;
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') setRefreshKey((k) => k + 1);
    }, autoMin * 60_000);
    return () => clearInterval(iv);
  }, [autoMin]);

  const transfer = async (kind: 'insight' | 'text', tileId: string, targetId: string, moveIt: boolean) => {
    setError(null);
    try {
      await api(`/api/analytics/dashboards/${dashboard.id}`, { method: 'PATCH', body: { transfer: { targetId, kind, tileId, move: moveIt } } });
      if (moveIt) {
        notifyChanged();
        router.refresh();
      }
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  };
  const [sharing, setSharing] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const noInsightOption = !allInsights.length ? t('noInsightsYet') : t('allAdded');

  const layout = layoutOf(dashboard.insightIds, settings);
  const move = (id: string, delta: -1 | 1) => {
    save({ ...settings, order: moveInLayout(layout, id, delta) });
  };

  const duplicate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { dashboard: created } = await api<{ dashboard: { id: string } }>('/api/analytics/dashboards', { body: { projectId, name: t('copyName', { name: dashboard.name.slice(0, 180) }), description: dashboard.description } });
      await api(`/api/analytics/dashboards/${created.id}`, { method: 'PATCH', body: { insightIds: dashboard.insightIds, settings } });
      notifyChanged();
      router.push(`/app/pulse/dashboards/${created.id}`);
    } catch (err) {
      setError(apiErrorText(err, tc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        back={{ href: '/app/pulse/dashboards', label: t('title') }}
        title={dashboard.name}
        description={dashboard.description || undefined}
        actions={
          <>
            <select
              className="select an-header-select"
              aria-label={t('addInsight')}
              value=""
              disabled={!available.length}
              onChange={(e) => e.target.value && void patch({ insightIds: [...dashboard.insightIds, e.target.value] })}
            >
              <option value="">{available.length ? t('addInsight') : noInsightOption}</option>
              {available.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!canShare} title={canShare ? undefined : t('shareAdminsOnly')} onClick={() => setSharing(true)}>
              {t('share')}
            </button>
            {canShare && (
              <button type="button" className="btn" onClick={() => setSubscribing(true)}>
                {t('subscribe')}
              </button>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => void duplicate()}>
              {t('duplicate')}
            </button>
            <button type="button" className="btn" onClick={() => setRenaming(true)}>
              {tc('rename')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(true)}>
              {tc('delete')}
            </button>
          </>
        }
      />
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {locked && (
        <p className="an-note" role="status" data-testid="an-board-locked">
          {t('sharedLocked')}
        </p>
      )}
      <div className="an-toolbar an-wrap">
        <label className="ui-check">
          <input type="checkbox" checked={range !== null} onChange={(e) => save({ ...settings, dateRange: e.target.checked ? { from: '-30d' } : null })} /> {t('overrideRange')}
        </label>
        {range && <DateRangePicker value={range} onChange={(dateRange) => save({ ...settings, dateRange })} />}
        <label className="ui-field an-inline-field">
          <span className="label">{t('autoRefresh')}</span>
          <select className="select" value={autoMin} onChange={(e) => save({ ...settings, autoRefreshMin: Number(e.target.value) })}>
            {AUTO_REFRESH_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m ? t('autoEvery', { n: m }) : t('autoOff')}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-sm" onClick={() => setRefreshKey((k) => k + 1)}>
          {t('refresh')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setAddingText(true)}>
          + {t('addText')}
        </button>
      </div>
      <details className="an-more an-dash-filters" open={settings.filters.length > 0 || Boolean(settings.cohortId) || (settings.internal ?? 'inherit') !== 'inherit' || undefined}>
        <summary>{t('filtersTitle')}</summary>
        <p className="ui-help">{t('filtersOn')}</p>
        <FilterList filters={settings.filters} onChange={(filters) => save({ ...settings, filters })} meta={meta} />
        <div className="an-row an-wrap">
          <label className="ui-field an-inline-field">
            <span className="label">{te('cohort')}</span>
            <select className="select" value={settings.cohortId ?? ''} disabled={!cohorts.length} onChange={(e) => save({ ...settings, cohortId: e.target.value || null })}>
              <option value="">{cohorts.length ? te('everyone') : te('noCohorts')}</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field an-inline-field">
            <span className="label">{t('internalLabel')}</span>
            <select className="select" value={settings.internal ?? 'inherit'} onChange={(e) => save({ ...settings, internal: e.target.value as 'inherit' | 'on' | 'off' })}>
              <option value="inherit">{t('internalInherit')}</option>
              <option value="on">{t('internalOn')}</option>
              <option value="off">{t('internalOff')}</option>
            </select>
          </label>
        </div>
      </details>
      {layout.length === 0 ? (
        <EmptyState
          product="pulse"
          title={t('tileEmptyTitle')}
          body={allInsights.length ? t('tileEmptyBody') : t('tileEmptyBodyNoInsights')}
          action={{ label: t('newInsight'), href: '/app/pulse/insights/new' }}
        />
      ) : (
        <div className="an-tiles">
          {layout.map((ref) => {
            if (ref.kind === 'text') {
              const text = settings.texts.find((x) => x.id === ref.id);
              if (!text) return null;
              return (
                <TextTile
                  key={ref.id}
                  body={text.body}
                  onEdit={(body) => save({ ...settings, texts: settings.texts.map((x) => (x.id === ref.id ? { ...x, body } : x)) })}
                  onDelete={() => save({ ...settings, texts: settings.texts.filter((x) => x.id !== ref.id), order: settings.order.filter((x) => x !== ref.id) })}
                  onMove={(d) => move(ref.id, d)}
                  others={otherDashboards}
                  onTransfer={(targetId, moveIt) => transfer('text', ref.id, targetId, moveIt)}
                />
              );
            }
            const i = insights.find((x) => x.id === ref.id);
            if (!i) return null;
            return (
              <Tile
                key={i.id}
                projectId={projectId}
                insight={i}
                settings={settings}
                tile={settings.tiles[i.id] ?? {}}
                onTile={(tile) => setTile(i.id, tile)}
                others={otherDashboards}
                onTransfer={(targetId, moveIt) => transfer('insight', i.id, targetId, moveIt)}
                refreshKey={refreshKey}
                annotations={annotations}
                meta={meta}
                onMove={(d) => move(i.id, d)}
                onRemove={() => void patch({ insightIds: dashboard.insightIds.filter((x) => x !== i.id) })}
              />
            );
          })}
        </div>
      )}
      <TextDialog
        open={addingText}
        initial=""
        onClose={() => setAddingText(false)}
        onSave={(body) => {
          const id = `at_${Math.random().toString(36).slice(2, 12)}`;
          save({ ...settings, texts: [...settings.texts, { id, body }] });
          setAddingText(false);
        }}
      />
      <SubscribeDialog
        open={subscribing}
        onClose={() => setSubscribing(false)}
        projectId={projectId}
        insights={insights.map((i) => ({ id: i.id, name: i.name }))}
        dashboards={[{ id: dashboard.id, name: dashboard.name, insightIds: dashboard.insightIds }]}
        target={{ dashboardId: dashboard.id }}
      />
      <ShareDialog open={sharing} onClose={() => setSharing(false)} projectId={projectId} target={{ dashboardId: dashboard.id }} />
      <NameDialog
        open={renaming}
        title={tc('rename')}
        label={t('name')}
        initial={dashboard.name}
        submitLabel={tc('save')}
        busy={busy}
        error={error}
        onClose={() => setRenaming(false)}
        onSubmit={async (name) => {
          if (await patch({ name })) setRenaming(false);
        }}
      />
      <ConfirmDialog
        open={deleting}
        title={t('deleteTitle', { name: dashboard.name })}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(`/api/analytics/dashboards/${dashboard.id}`, { method: 'DELETE' });
            notifyChanged();
            router.replace('/app/pulse/dashboards');
          } catch (err) {
            setError(errorText(err));
            setDeleting(false);
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
