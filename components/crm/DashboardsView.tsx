'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import MenuSelect from '@/components/ui/MenuSelect';
import { ContextMenu, type ContextMenuAnchor, type ContextMenuItem } from '@/components/ui/ContextMenu';
import RecordPreview from './RecordPreview';
import ReportChart from './ReportChart';
import DashChart, { ChartTable, type ChartText } from './dash/DashChart';
import { bucketLabel, bucketsSpanYears } from '@/lib/crm-buckets';
import { LIFECYCLE_STAGES, SOURCES, ACTIVITY_TYPES } from '@/lib/crm-constants';
import { toCsv } from '@/lib/crm-report-builder';
import type { DashboardView } from '@/lib/crm-dashboards';
import type { DashboardVisibility, DashboardAccess, TileData } from '@/lib/crm-dashboards-schema';
import {
  DATE_PRESETS,
  LIBRARY,
  REPORT_CATEGORIES,
  legacyReportKey,
  libraryReport,
  parseDashboardFilters,
  resolveRange,
  sizeFromCols,
  type DashboardFilters,
  type DrillResult,
  type DrillRow,
  type DrillSegment,
  type TileResult,
  type TileSize,
  type TileViz,
  type ValueFormat,
} from '@/lib/crm-dashboard-library';

interface Props {
  dashboards: DashboardView[];
  activeId: string | null;
  initialTiles: Record<string, TileData>;
  pipelines: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
  customReports: Array<{ id: string; name: string }>;
  locale: string;
  baseCurrency?: string;
  missingRates?: string[];
}

type Widget = DashboardView['widgets'][number];
type TileState = TileData | { kind: 'loading' };
type PreviewTarget = { type: 'contact' | 'company' | 'deal'; id: string };

interface DrillState {
  widgetId: string;
  title: string;
  subtitle: string | null;
  status: 'loading' | 'error' | 'ready';
  result?: DrillResult;
  returnFocus: HTMLElement | null;
}

type Dialog = null | 'create' | 'rename' | 'share' | 'delete' | 'library' | { edit: string };

const SIZE_W: Record<TileSize, number> = { small: 3, medium: 6, wide: 12 };

function cfgOf(raw: string): { reportKey?: string; reportId?: string; title?: string; viz?: TileViz; metric?: string } {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, never>) : {};
  } catch {
    return {};
  }
}

function tileKey(w: { type: string; config: string }): string | null {
  const c = cfgOf(w.config);
  if (w.type === 'library') return libraryReport(c.reportKey)?.key ?? null;
  if (w.type === 'custom_report') return null;
  return legacyReportKey(w.type, c);
}

function sameFilters(a: DashboardFilters, b: DashboardFilters): boolean {
  const n = (f: DashboardFilters) =>
    JSON.stringify([f.range, f.range === 'custom' ? f.from ?? '' : '', f.range === 'custom' ? f.to ?? '' : '', f.ownerId ?? '', f.teamId ?? '', f.pipelineId ?? '']);
  return n(a) === n(b);
}

/** El botón que abrió el último menú: un diálogo abierto desde un ítem del menú devuelve el foco ahí al cerrar. */
let lastMenuTrigger: HTMLElement | null = null;

function focusBack(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body && el.isConnected ? el : lastMenuTrigger;
}

function setUrlDashboard(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('d', id);
  window.history.replaceState(window.history.state, '', url.toString());
}

/** Cerrar al hacer clic afuera o con Esc (popovers propios). */
function useDismiss(open: boolean, refs: Array<React.RefObject<HTMLElement | null>>, onClose: (restore: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return;
      onClose(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(true);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [open, refs, onClose]);
}

/**
 * Dashboards del CRM como los de HubSpot: selector de dashboards, filtros
 * que aplican a todos los tiles, grilla de reportes (arrastrar para
 * reordenar, tamaño chico/mediano/ancho, menú por tile), biblioteca de
 * reportes listos y drill-down a los registros con su vista previa.
 */
export default function DashboardsView({
  dashboards,
  activeId: initialActive,
  initialTiles,
  pipelines,
  owners,
  teams,
  customReports,
  locale,
  baseCurrency = 'USD',
  missingRates = [],
}: Props) {
  const t = useTranslations('crm');
  const [boards, setBoards] = useState(dashboards);
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
  const [activeId, setActiveId] = useState<string | null>(initialActive);
  const active = boards.find((b) => b.id === activeId) ?? null;
  const [filters, setFilters] = useState<DashboardFilters>(() => parseDashboardFilters(active?.filters ?? '{}'));
  const [tiles, setTiles] = useState<Record<string, TileState>>(initialTiles);
  const [asTable, setAsTable] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [menu, setMenu] = useState<{ anchor: ContextMenuAnchor; items: ContextMenuItem[] } | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState<{ from: string; to: string } | null>(null);
  const requestRef = useRef(0);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((v) => (v === msg ? null : v)), 2400);
  }, []);

  // ---------- Formato ----------

  const money = useMemo(() => new Intl.NumberFormat(locale, { style: 'currency', currency: baseCurrency, maximumFractionDigits: 0 }), [locale, baseCurrency]);
  const moneyCompact = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: baseCurrency, notation: 'compact', maximumFractionDigits: 1 }),
    [locale, baseCurrency],
  );
  const num = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);
  const numCompact = useMemo(() => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }), [locale]);
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }), [locale]);

  const fmtValue = useCallback(
    (n: number, format: ValueFormat = 'number') => {
      if (format === 'money') return money.format(n);
      if (format === 'percent') return `${num.format(n)}%`;
      if (format === 'days') return t('dash.tile.days', { value: num.format(n) });
      if (format === 'moneyPerDay') return t('dash.tile.perDay', { value: money.format(n) });
      return num.format(n);
    },
    [money, num, t],
  );
  const fmtAxis = useCallback(
    (n: number, format: ValueFormat = 'number') => {
      const big = Math.abs(n) >= 10_000;
      if (format === 'money' || format === 'moneyPerDay') return big ? moneyCompact.format(n) : money.format(n);
      return big ? numCompact.format(n) : num.format(n);
    },
    [money, moneyCompact, num, numCompact],
  );
  const fmtDate = useCallback(
    (iso: string | null) => {
      if (!iso) return '';
      const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso.replace(' ', 'T') : `${iso.replace(' ', 'T')}Z`;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
    },
    [dateFmt],
  );

  const enumLabel = useCallback(
    (kind: string | null, key: string, label: string | null, withYear = false): string => {
      if (kind === 'bucket') return bucketLabel(key, locale, withYear);
      if (kind === 'source') return (SOURCES as readonly string[]).includes(key) ? t(`enums.source.${key}`) : key;
      if (kind === 'lifecycle') return (LIFECYCLE_STAGES as readonly string[]).includes(key) ? t(`enums.lifecycle.${key}`) : key;
      if (kind === 'forecastCategory') return ['closed_won', 'commit', 'best_case', 'pipeline'].includes(key) ? t(`dash.forecastCat.${key}`) : key;
      if (kind === 'activityType') return (ACTIVITY_TYPES as readonly string[]).includes(key) ? t(`enums.activityType.${key}`) : key;
      if (kind === 'outcome') return ['won', 'lost', 'call', 'email', 'meeting', 'task', 'value'].includes(key) ? t(`dash.series.${key}`) : key;
      return label ?? t('dash.tile.formerMember');
    },
    [locale, t],
  );

  const chartText = useCallback(
    (data: Extract<TileResult, { kind: 'chart' }>): ChartText => {
      // Un rango que cruza años (últimos 365 días) pone el año en cada período.
      const withYear = data.categoryKind === 'bucket' && bucketsSpanYears(data.categories.map((c) => c.key));
      return {
      category: (key, label) => enumLabel(data.categoryKind, key, label, withYear),
      series: (key, label) => (data.seriesKind ? enumLabel('outcome', key, label) : t('dash.tile.total')),
      value: fmtValue,
      axis: fmtAxis,
      extra: (n, kind) => (n === null ? null : kind === 'count' ? t('dash.tile.deals', { count: n }) : t('dash.tile.conversion', { value: n })),
      aria: (parts) => parts.join(', '),
      total: t('dash.tile.total'),
      };
    },
    [enumLabel, fmtAxis, fmtValue, t],
  );

  // ---------- Carga de tiles ----------

  const loadTiles = useCallback(async (dashboardId: string, f: DashboardFilters, widgetIds?: string[]) => {
    const req = widgetIds ? requestRef.current : ++requestRef.current;
    const ids = widgetIds ?? boardsRef.current.find((b) => b.id === dashboardId)?.widgets.map((w) => w.id) ?? [];
    setTiles((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { kind: 'loading' };
      return next;
    });
    const res = await fetch('/api/crm/dashboards/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dashboardId, filters: f, widgetIds }),
    }).catch(() => null);
    // Una respuesta vieja (cambiaron los filtros mientras tanto) no pisa la nueva.
    if (req !== requestRef.current) return;
    if (!res || !res.ok) {
      setTiles((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = { kind: 'error', code: 'report_failed' };
        return next;
      });
      return;
    }
    const data = (await res.json()) as { tiles: Record<string, TileData> };
    if (req !== requestRef.current) return;
    setTiles((prev) => ({ ...prev, ...data.tiles }));
  }, []);

  function selectBoard(id: string, list = boardsRef.current) {
    const b = list.find((x) => x.id === id);
    if (!b) return;
    setActiveId(id);
    setSwitcherOpen(false);
    setCustomDraft(null);
    setAsTable(new Set());
    const f = parseDashboardFilters(b.filters);
    setFilters(f);
    setUrlDashboard(id);
    if (b.widgets.length) void loadTiles(id, f);
  }

  function applyFilters(next: DashboardFilters) {
    setFilters(next);
    if (active) void loadTiles(active.id, next);
  }

  const savedFilters = active ? parseDashboardFilters(active.filters) : null;
  const filtersDirty = !!savedFilters && !sameFilters(filters, savedFilters);

  // ---------- Llamadas ----------

  async function patchBoard(id: string, body: Record<string, unknown>): Promise<DashboardView | null> {
    setError(null);
    const res = await fetch(`/api/crm/dashboards/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res || !res.ok) {
      setError(t('errors.generic'));
      return null;
    }
    if (res.status === 204) {
      // Ya no lo ve (un admin lo hizo privado de otra persona): sale de la lista.
      const rest = boardsRef.current.filter((b) => b.id !== id);
      setBoards(rest);
      boardsRef.current = rest;
      setDialog(null);
      const next = rest.find((b) => b.isDefault) ?? rest[0];
      if (next) selectBoard(next.id, rest);
      else setActiveId(null);
      return null;
    }
    const updated = (await res.json()) as DashboardView;
    setBoards((prev) => prev.map((b) => (b.id === id ? updated : body.isDefault ? { ...b, isDefault: false } : b)));
    return updated;
  }

  async function createBoard(body: { name: string; template?: 'blank' | 'sales'; cloneFrom?: string }) {
    setError(null);
    const res = await fetch('/api/crm/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res || !res.ok) {
      setError(t('errors.generic'));
      return;
    }
    const created = (await res.json()) as DashboardView;
    const list = [...boardsRef.current, created];
    setBoards(list);
    boardsRef.current = list;
    setDialog(null);
    selectBoard(created.id, list);
  }

  async function deleteBoard() {
    if (!active) return;
    const res = await fetch(`/api/crm/dashboards/${active.id}`, { method: 'DELETE' }).catch(() => null);
    setDialog(null);
    if (!res || !res.ok) {
      setError(t('errors.generic'));
      return;
    }
    const rest = boards.filter((b) => b.id !== active.id);
    setBoards(rest);
    boardsRef.current = rest;
    const next = rest.find((b) => b.isDefault) ?? rest[0];
    if (next) selectBoard(next.id, rest);
    else setActiveId(null);
  }

  async function addTile(body: Record<string, unknown>): Promise<boolean> {
    if (!active) return false;
    const res = await fetch(`/api/crm/dashboards/${active.id}/widgets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res || !res.ok) {
      setError(t('errors.generic'));
      return false;
    }
    const w = (await res.json()) as Widget;
    const dup = typeof body.duplicateOf === 'string';
    setBoards((prev) =>
      prev.map((b) => {
        if (b.id !== active.id) return b;
        const shifted = dup ? b.widgets.map((x) => (x.position >= w.position ? { ...x, position: x.position + 1 } : x)) : b.widgets;
        return { ...b, widgets: [...shifted, w].sort((a, c) => a.position - c.position) };
      }),
    );
    void loadTiles(active.id, filters, [w.id]);
    return true;
  }

  async function patchTile(id: string, body: Record<string, unknown>) {
    if (!active) return;
    const res = await fetch(`/api/crm/dashboards/widgets/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res || !res.ok) {
      setError(t('errors.generic'));
      return;
    }
    const w = (await res.json()) as Widget;
    setBoards((prev) => prev.map((b) => (b.id === active.id ? { ...b, widgets: b.widgets.map((x) => (x.id === id ? w : x)) } : b)));
  }

  async function removeTile(id: string) {
    if (!active) return;
    const snapshot = boards;
    setBoards((prev) => prev.map((b) => (b.id === active.id ? { ...b, widgets: b.widgets.filter((x) => x.id !== id) } : b)));
    const res = await fetch(`/api/crm/dashboards/widgets/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!res || !res.ok) {
      setBoards(snapshot);
      setError(t('errors.generic'));
    }
  }

  /** Mueve un tile a otra posición (arrastre, menú o teclado) y guarda el orden. */
  async function moveTile(id: string, toIndex: number) {
    if (!active) return;
    const list = [...active.widgets];
    const from = list.findIndex((w) => w.id === id);
    if (from < 0) return;
    const [item] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, item);
    const snapshot = boards;
    setBoards((prev) => prev.map((b) => (b.id === active.id ? { ...b, widgets: list.map((w, i) => ({ ...w, position: i })) } : b)));
    const ok = await patchBoard(active.id, { order: list.map((w, i) => ({ id: w.id, position: i })) });
    if (!ok) setBoards(snapshot);
  }

  async function resizeTile(id: string, size: TileSize) {
    if (!active) return;
    setBoards((prev) => prev.map((b) => (b.id === active.id ? { ...b, widgets: b.widgets.map((w) => (w.id === id ? { ...w, w: SIZE_W[size] } : w)) } : b)));
    await patchTile(id, { size });
  }

  // ---------- Drill-down ----------

  const drillReq = useRef(0);
  async function openDrill(widgetId: string, segment: DrillSegment, title: string, subtitle: string | null) {
    if (!active) return;
    const req = ++drillReq.current;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDrill({ widgetId, title, subtitle, status: 'loading', returnFocus });
    const res = await fetch('/api/crm/dashboards/drill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dashboardId: active.id, widgetId, filters, segment }),
    }).catch(() => null);
    if (req !== drillReq.current) return;
    if (!res || !res.ok) {
      setDrill((d) => (d ? { ...d, status: 'error' } : d));
      return;
    }
    const result = (await res.json()) as DrillResult;
    // Una respuesta de un drill anterior no pisa el que está abierto.
    if (req !== drillReq.current) return;
    setDrill((d) => (d ? { ...d, status: 'ready', result } : d));
  }

  // ---------- Títulos ----------

  function tileTitle(w: Widget): string {
    const c = cfgOf(w.config);
    if (c.title) return c.title;
    if (w.type === 'custom_report') {
      const d = tiles[w.id];
      if (d?.kind === 'custom') return d.report.name;
      return customReports.find((r) => r.id === c.reportId)?.name ?? t('dashboards.widgets.custom_report');
    }
    const key = tileKey(w);
    return key ? t(`dash.reports.${key}.name`) : t('dashboards.widgets.custom_report');
  }

  function rangeLabel(f: DashboardFilters): string {
    if (f.range !== 'custom') return t(`dash.ranges.${f.range}`);
    const r = resolveRange(f);
    return `${fmtDate(r.from)} – ${fmtDate(r.to)}`;
  }

  function tileSubtitle(w: Widget): string {
    if (w.type === 'custom_report') {
      // El rango del dashboard se aplica si el reporte tiene un campo de fecha (lo dice el resultado).
      const d = tiles[w.id];
      return d?.kind === 'custom' && d.report.result.dateField ? rangeLabel(filters) : t('dash.tile.allDates');
    }
    const def = libraryReport(tileKey(w));
    // Los reportes por etapa usan un pipeline: el del filtro o el primero.
    const stagePipe =
      def && ['pipeline_by_stage', 'conversion_funnel', 'avg_time_in_stage'].includes(def.key)
        ? pipelines.find((p) => p.id === filters.pipelineId)?.name ?? pipelines[0]?.name
        : null;
    if (def?.rangeMode === 'snapshot') return [t('dash.tile.current'), stagePipe].filter(Boolean).join(' · ');
    if (stagePipe) return `${rangeLabel(filters)} · ${stagePipe}`;
    if (def?.rangeMode === 'this_month') return t('dash.tile.thisMonth');
    return rangeLabel(filters);
  }

  function statusLabel(r: DrillRow): string {
    if (!r.status) return '';
    if (r.statusKind === 'stage') return r.status;
    return enumLabel(r.statusKind, r.status, r.status);
  }

  // ---------- Menús ----------

  function anchorFrom(el: HTMLElement, label: string): ContextMenuAnchor {
    lastMenuTrigger = el;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4, label, returnFocus: el };
  }

  function openBoardMenu(el: HTMLElement) {
    if (!active) return;
    const items: ContextMenuItem[] = [];
    if (active.canEdit) items.push({ key: 'rename', label: t('dash.actions.rename'), onSelect: () => setDialog('rename') });
    items.push({
      key: 'clone',
      label: t('dash.actions.clone'),
      onSelect: () => void createBoard({ name: t('dash.cloneName', { name: active.name }).slice(0, 200), cloneFrom: active.id }),
    });
    if (active.canManage) items.push({ key: 'share', label: t('dash.actions.share'), onSelect: () => setDialog('share') });
    if (!active.isDefault) items.push({ key: 'default', label: t('dash.actions.setDefault'), onSelect: () => void patchBoard(active.id, { isDefault: true }) });
    if (active.canManage) items.push({ key: 'delete', label: t('dash.actions.delete'), danger: true, divider: true, onSelect: () => setDialog('delete') });
    setMenu({ anchor: anchorFrom(el, t('dash.actions.menu')), items });
  }

  function openTileMenu(el: HTMLElement, w: Widget, index: number) {
    if (!active) return;
    const title = tileTitle(w);
    const data = tiles[w.id];
    const items: ContextMenuItem[] = [];
    if (active.canEdit) items.push({ key: 'edit', label: t('dash.tile.edit'), onSelect: () => setDialog({ edit: w.id }) });
    if (data?.kind === 'chart') {
      const on = asTable.has(w.id);
      items.push({
        key: 'table',
        label: on ? t('dash.tile.viewChart') : t('dash.tile.viewTable'),
        onSelect: () =>
          setAsTable((prev) => {
            const next = new Set(prev);
            if (on) next.delete(w.id);
            else next.add(w.id);
            return next;
          }),
      });
    }
    if (data && data.kind !== 'loading' && data.kind !== 'error') items.push({ key: 'csv', label: t('dash.tile.exportCsv'), onSelect: () => exportCsv(w, title) });
    const rid = w.type === 'custom_report' ? cfgOf(w.config).reportId : undefined;
    if (rid) items.push({ key: 'open', label: t('dash.tile.openReport'), onSelect: () => window.location.assign(`/${locale}/app/crm/reports/custom/${rid}`) });
    if (active.canEdit) {
      const size = sizeFromCols(w.w);
      items.push({ key: 'dup', label: t('dash.tile.duplicate'), onSelect: () => void addTile({ type: 'library', duplicateOf: w.id }) });
      items.push({
        key: 'size',
        label: t('dash.tile.size'),
        submenu: (['small', 'medium', 'wide'] as const).map((s) => ({
          key: s,
          label: `${s === size ? '✓ ' : ''}${t(`dash.tile.${s}`)}`,
          onSelect: () => void resizeTile(w.id, s),
        })),
      });
      if (index > 0) items.push({ key: 'up', label: t('dash.tile.moveEarlier'), onSelect: () => void moveTile(w.id, index - 1) });
      if (index < active.widgets.length - 1) items.push({ key: 'down', label: t('dash.tile.moveLater'), onSelect: () => void moveTile(w.id, index + 1) });
      items.push({ key: 'remove', label: t('dash.tile.remove'), danger: true, divider: true, onSelect: () => void removeTile(w.id) });
    }
    setMenu({ anchor: anchorFrom(el, t('dash.tile.menu', { name: title })), items });
  }

  function exportCsv(w: Widget, title: string) {
    const data = tiles[w.id];
    if (!data || data.kind === 'loading' || data.kind === 'error') return;
    let header: string[] = [];
    let rows: Array<Array<string | number | null>> = [];
    if (data.kind === 'kpi') {
      header = [title, t('dash.tile.vsPrev')];
      rows = [[data.value, data.prev]];
    } else if (data.kind === 'chart') {
      const text = chartText(data);
      header = ['', ...data.series.map((s) => text.series(s.key, s.label))];
      rows = data.categories.map((c, i) => [text.category(c.key, c.label), ...data.series.map((s) => s.values[i])]);
    } else if (data.kind === 'records') {
      header = [t('dash.drill.cols.name'), t('dash.drill.cols.amount'), t('dash.drill.cols.status'), t('dash.drill.cols.owner'), t('dash.drill.cols.date')];
      rows = data.rows.map((r) => [r.name, r.amount, statusLabel(r), r.owner ?? '', r.date ?? '']);
    } else {
      const res = data.report.result;
      if (res.kind === 'aggregate') {
        header = [...res.dimensions.map((d) => d.label ?? d.key), title];
        rows = res.rows.map((r) => [...r.keys.map((k) => (k ? res.labels[`owner:${k}`] ?? res.labels[`stage:${k}`] ?? res.labels[`pipeline:${k}`] ?? k : '')), r.value]);
      } else {
        header = res.columns.map((c) => c.label ?? c.key);
        rows = res.rows.map((r) => r.cells);
      }
    }
    const blob = new Blob([`﻿${toCsv(header, rows)}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\p{L}\p{N}\- _]/gu, '').slice(0, 80) || 'report'}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Arrastrar para reordenar ----------

  const dragRef = useRef<{ id: string; pointerId: number; x: number; y: number; active: boolean } | null>(null);
  const dropRef = useRef<{ id: string; after: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);

  function setDrop(v: { id: string; after: boolean } | null) {
    dropRef.current = v;
    setDropAt(v);
  }

  function gripDown(e: ReactPointerEvent<HTMLElement>, id: string) {
    if (!active?.canEdit || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (window.matchMedia('(max-width: 640px)').matches) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    dragRef.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false };
  }

  function gripMove(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      d.active = true;
      setDragging(d.id);
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-tile-id]');
    const over = el?.dataset.tileId;
    if (!el || !over || over === d.id) {
      setDrop(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setDrop({ id: over, after: e.clientX > r.left + r.width / 2 });
  }

  function gripUp(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(null);
    const target = dropRef.current;
    setDrop(null);
    if (!d.active || !target || !active) return;
    const rest = active.widgets.filter((w) => w.id !== d.id);
    const idx = rest.findIndex((w) => w.id === target.id);
    if (idx < 0) return;
    void moveTile(d.id, idx + (target.after ? 1 : 0));
  }

  function gripCancel() {
    dragRef.current = null;
    setDragging(null);
    setDrop(null);
  }

  function gripKey(e: ReactKeyboardEvent<HTMLElement>, id: string, index: number) {
    if (!active?.canEdit) return;
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && index > 0) {
      e.preventDefault();
      void moveTile(id, index - 1).then(() => focusGrip(id));
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && index < active.widgets.length - 1) {
      e.preventDefault();
      void moveTile(id, index + 1).then(() => focusGrip(id));
    }
  }

  function focusGrip(id: string) {
    document.querySelector<HTMLElement>(`[data-tile-id="${id}"] .cdb-grip`)?.focus();
  }

  useEffect(() => {
    if (!dragging) return;
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      dragRef.current = null;
      dropRef.current = null;
      setDragging(null);
      setDropAt(null);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [dragging]);

  // ---------- Cuerpo de un tile ----------

  function renderBody(w: Widget): ReactNode {
    const data = tiles[w.id];
    const title = tileTitle(w);
    const subtitle = tileSubtitle(w);
    if (!data || data.kind === 'loading') {
      return (
        <div className="cdb-skeleton" aria-busy="true" aria-label={t('dash.tile.loading')}>
          <span />
          <span />
          <span />
        </div>
      );
    }
    if (data.kind === 'error') {
      const msg = data.code === 'report_missing' ? t('dash.tile.reportMissing') : data.code === 'invalid_field' ? t('dash.tile.fieldHidden') : t('dash.tile.error');
      return <p className="cdb-empty">{msg}</p>;
    }
    if (data.kind === 'custom') {
      return (
        <div className="cdb-custom">
          <ReportChart
            result={data.report.result}
            viz={data.report.config.viz}
            locale={locale}
            baseCurrency={baseCurrency}
            compact
            onDrill={(keys, label) => void openDrill(w.id, { keys }, title, [label, subtitle].filter(Boolean).join(' · '))}
          />
        </div>
      );
    }
    if (data.kind === 'kpi') {
      const valueText = fmtValue(data.value, data.format);
      // Un número de siete cifras va compacto ($1.2M) para que no se corte; el entero queda en el nombre accesible.
      const big = Math.abs(data.value) >= 1_000_000 && (data.format === 'money' || data.format === 'moneyPerDay' || data.format === 'number');
      const shown = big ? (data.format === 'number' ? numCompact.format(data.value) : moneyCompact.format(data.value)) : data.format === 'moneyPerDay' ? fmtValue(data.value, 'money') : valueText;
      const key = tileKey(w);
      const d = data.detail;
      const velocity = key === 'sales_velocity';
      const detail =
        d?.closed !== undefined
          ? t('dash.tile.winDetail', { won: d.won ?? 0, closed: d.closed })
          : velocity && d?.count !== undefined && d.cycle
            ? t('dash.tile.velocityDetail', { count: d.count, cycle: num.format(Math.round(d.cycle)) })
            : d?.count !== undefined
              ? velocity
                ? t('dash.tile.openDeals', { count: d.count })
                : t('dash.tile.deals', { count: d.count })
              : null;
      const formula =
        velocity && d?.cycle
          ? t('dash.tile.velocityFormula', {
              open: num.format(d.count ?? 0),
              rate: num.format(d.rate ?? 0),
              avg: fmtValue(d.avg ?? 0, 'money'),
              cycle: num.format(Math.round(d.cycle)),
            })
          : null;
      return (
        <div className="cdb-kpi">
          {data.drill ? (
            <button
              type="button"
              className="cdb-kpi-value"
              data-testid="cdb-kpi-value"
              aria-label={`${title}: ${valueText}`}
              title={formula ?? (big ? valueText : undefined)}
              onClick={() => void openDrill(w.id, {}, title, subtitle)}
            >
              {shown}
              {data.format === 'moneyPerDay' && <span className="cdb-kpi-unit">{t('dash.tile.perDayUnit')}</span>}
            </button>
          ) : (
            <span className="cdb-kpi-value">{shown}</span>
          )}
          <div className="cdb-kpi-meta">
            <KpiDelta value={data.value} prev={data.prev} format={data.format} fmtValue={fmtValue} num={num} t={t} />
            {detail && <span className="cdb-muted">{detail}</span>}
          </div>
        </div>
      );
    }
    if (data.kind === 'records') {
      if (!data.rows.length) return <p className="cdb-empty">{t('dash.tile.noData')}</p>;
      return (
        <div className="cdb-records">
          <ul className="cdb-rec-list">
            {data.rows.slice(0, 8).map((r) => (
              <li key={r.id}>
                <RecordLink row={r} onPreview={setPreview} />
                <span className="cdb-rec-meta">
                  {r.amount !== null ? fmtValue(r.amount, 'money') : statusLabel(r)}
                  {r.date ? ` · ${fmtDate(r.date)}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <div className="cdb-rec-foot">
            <span className="cdb-muted">
              {t('dash.tile.records', { count: data.total })}
              {data.sum !== null ? ` · ${fmtValue(data.sum, 'money')}` : ''}
            </span>
            <button type="button" className="cdb-link" onClick={() => void openDrill(w.id, {}, title, subtitle)}>
              {t('dash.tile.seeAll')}
            </button>
          </div>
        </div>
      );
    }
    const def = libraryReport(tileKey(w));
    const cfg = cfgOf(w.config);
    const viz: TileViz = asTable.has(w.id) ? 'table' : cfg.viz && def?.vizOptions.includes(cfg.viz) ? cfg.viz : def?.viz ?? 'bar';
    const hasData = data.series.some((s) => s.values.some((v) => v !== 0));
    if (!data.categories.length || !hasData) return <p className="cdb-empty">{t('dash.tile.noData')}</p>;
    const text = chartText(data);
    const onDrill = data.drill
      ? (seg: DrillSegment) => {
          const parts = [
            seg.category ? text.category(seg.category, data.categories.find((c) => c.key === seg.category)?.label ?? null) : null,
            seg.series ? text.series(seg.series, null) : null,
            subtitle,
          ].filter(Boolean);
          void openDrill(w.id, seg, title, parts.join(' · '));
        }
      : null;
    return (
      <>
        {data.total !== null && data.format !== 'days' && viz !== 'table' && viz !== 'donut' && (
          <p className="cdb-total">
            <span className="cdb-total-num">{fmtValue(data.total, data.format)}</span> <span className="cdb-muted">{t('dash.tile.total')}</span>
          </p>
        )}
        {viz === 'table' ? <ChartTable data={data} text={text} onDrill={onDrill} /> : <DashChart data={data} viz={viz} text={text} onDrill={onDrill} title={title} />}
      </>
    );
  }

  const allEmpty = useMemo(() => {
    if (!active || !active.widgets.length) return false;
    const vals = active.widgets.map((w) => tiles[w.id]);
    return vals.every((v) => {
      if (!v) return false;
      if (v.kind === 'kpi') return v.value === 0;
      if (v.kind === 'chart') return v.series.every((s) => s.values.every((x) => x === 0));
      if (v.kind === 'records') return v.total === 0;
      return false;
    });
  }, [active, tiles]);

  // ---------- Selector ----------

  const switcherBtn = useRef<HTMLButtonElement>(null);
  const switcherPanel = useRef<HTMLDivElement>(null);
  const closeSwitcher = useCallback((restore: boolean) => {
    setSwitcherOpen(false);
    if (restore) switcherBtn.current?.focus();
  }, []);
  const switcherRefs = useMemo(() => [switcherBtn, switcherPanel], []);
  useDismiss(switcherOpen, switcherRefs, closeSwitcher);

  const visibilityLabel = (b: DashboardView) =>
    b.visibility === 'private'
      ? t('dash.visibility.private')
      : b.visibility === 'team'
        ? t('dash.visibility.team', { team: teams.find((x) => x.id === b.team_id)?.name ?? t('dash.visibility.teamPlain') })
        : t('dash.visibility.everyone');

  const rangeOptions = DATE_PRESETS.map((p) => ({ value: p, label: t(`dash.ranges.${p}`) }));
  const ownerOptions = [{ value: '', label: t('dash.filters.allOwners') }, ...owners.map((o) => ({ value: o.id, label: o.name }))];
  const teamOptions = [{ value: '', label: t('dash.filters.allTeams') }, ...teams.map((o) => ({ value: o.id, label: o.name }))];
  const pipelineOptions = [{ value: '', label: t('dash.filters.allPipelines') }, ...pipelines.map((o) => ({ value: o.id, label: o.name }))];
  const editing = dialog && typeof dialog === 'object' && active ? active.widgets.find((x) => x.id === dialog.edit) ?? null : null;

  return (
    <div className="cdb">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {missingRates.length > 0 && <p className="muted currency-note">{t('currency.missing', { list: missingRates.join(', ') })}</p>}

      <div className="cdb-head">
        <div className="cdb-switcher">
          <button
            ref={switcherBtn}
            type="button"
            className="cdb-switcher-btn"
            aria-haspopup="dialog"
            aria-expanded={switcherOpen}
            data-testid="cdb-switcher"
            onClick={() => setSwitcherOpen((v) => !v)}
          >
            <span className="cdb-switcher-name">{active?.name ?? t('dashboards.title')}</span>
            <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden>
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          {switcherOpen && (
            <SwitcherPanel
              panelRef={switcherPanel}
              boards={boards}
              activeId={activeId}
              onPick={(id) => selectBoard(id)}
              onCreate={() => {
                setSwitcherOpen(false);
                setDialog('create');
              }}
              t={t}
              visibilityLabel={visibilityLabel}
            />
          )}
        </div>
        {active && (
          <p className="cdb-meta" data-testid="cdb-meta">
            {active.canManage ? (
              <button type="button" className="cdb-meta-share" data-testid="cdb-visibility" onClick={() => setDialog('share')}>
                <VisibilityIcon visibility={active.visibility} />
                {visibilityLabel(active)}
              </button>
            ) : (
              <span className="cdb-meta-item">
                <VisibilityIcon visibility={active.visibility} />
                {visibilityLabel(active)}
              </span>
            )}
            {active.ownerName && !active.isOwner && <span className="cdb-meta-item">{t('dash.switcher.ownedBy', { name: active.ownerName })}</span>}
            {!active.canEdit && <span className="cdb-meta-item">{t('dash.viewOnly')}</span>}
            {active.isDefault && <span className="cdb-meta-item">{t('dash.switcher.default')}</span>}
          </p>
        )}
        <div className="cdb-head-actions">
          {active ? (
            <button type="button" className="btn btn-sm" aria-haspopup="menu" data-testid="cdb-actions" onClick={(e) => openBoardMenu(e.currentTarget)}>
              {t('dash.actions.menu')}
              <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden className="cdb-btn-chevron">
                <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog('create')}>
              {t('dash.switcher.create')}
            </button>
          )}
          {active?.canEdit && (
            <button type="button" className="btn btn-sm btn-primary" data-testid="cdb-add-report" onClick={() => setDialog('library')}>
              {t('dash.addReport')}
            </button>
          )}
        </div>
      </div>

      {active && (
        <div className="cdb-filters" role="group" aria-label={t('dash.filters.label')} data-testid="cdb-filters">
          <MenuSelect
            label={t('dash.filters.range')}
            testId="cdb-filter-range"
            value={customDraft ? 'custom' : filters.range}
            options={rangeOptions}
            onChange={(v) => {
              if (v === 'custom') {
                const r = resolveRange(filters);
                setCustomDraft({ from: filters.from ?? r.from, to: filters.to ?? r.to });
                return;
              }
              setCustomDraft(null);
              applyFilters({ ...filters, range: v as DashboardFilters['range'], from: undefined, to: undefined });
            }}
          />
          {(customDraft || filters.range === 'custom') && (
            <form
              className="cdb-custom-range"
              onSubmit={(e) => {
                e.preventDefault();
                if (!customDraft?.from || !customDraft.to) return;
                const d = customDraft;
                setCustomDraft(null);
                applyFilters({ ...filters, range: 'custom', from: d.from, to: d.to });
              }}
            >
              <input
                type="date"
                className="input cdb-date"
                aria-label={t('dash.filters.from')}
                value={customDraft?.from ?? filters.from ?? ''}
                onChange={(e) => setCustomDraft((d) => ({ from: e.target.value, to: d?.to ?? filters.to ?? '' }))}
              />
              <input
                type="date"
                className="input cdb-date"
                aria-label={t('dash.filters.to')}
                value={customDraft?.to ?? filters.to ?? ''}
                onChange={(e) => setCustomDraft((d) => ({ from: d?.from ?? filters.from ?? '', to: e.target.value }))}
              />
              {customDraft && (
                <button type="submit" className="btn btn-sm">
                  {t('dash.filters.apply')}
                </button>
              )}
            </form>
          )}
          {owners.length > 0 && (
            <MenuSelect
              label={t('dash.filters.owner')}
              testId="cdb-filter-owner"
              value={filters.ownerId ?? ''}
              options={ownerOptions}
              onChange={(v) => applyFilters({ ...filters, ownerId: v || null, teamId: v ? null : filters.teamId })}
            />
          )}
          <MenuSelect
              label={t('dash.filters.team')}
              testId="cdb-filter-team"
              value={filters.teamId ?? ''}
              options={teamOptions}
              onChange={(v) => applyFilters({ ...filters, teamId: v || null, ownerId: v ? null : filters.ownerId })}
            />
          {pipelines.length > 0 && (
            <MenuSelect
              label={t('dash.filters.pipeline')}
              testId="cdb-filter-pipeline"
              value={filters.pipelineId ?? ''}
              options={pipelineOptions}
              onChange={(v) => applyFilters({ ...filters, pipelineId: v || null })}
            />
          )}
          {filtersDirty && savedFilters && (
            <span className="cdb-filter-actions">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setCustomDraft(null);
                  applyFilters(savedFilters);
                }}
              >
                {t('dash.filters.reset')}
              </button>
              {active.canEdit && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    if (await patchBoard(active.id, { filters })) flash(t('dash.filters.saved'));
                  }}
                >
                  {t('dash.filters.save')}
                </button>
              )}
            </span>
          )}
        </div>
      )}

      <p className="cdb-notice" role="status" aria-live="polite">
        {notice ?? ''}
      </p>

      {!active ? (
        <EmptyState
          title={t('dash.empty.noDashTitle')}
          body={t('dash.empty.noDashBody')}
          product="crm"
          action={
            <button type="button" className="btn btn-primary" onClick={() => setDialog('create')}>
              {t('dash.switcher.create')}
            </button>
          }
        />
      ) : active.widgets.length === 0 ? (
        <EmptyState
          title={t('dash.empty.title')}
          body={t('dash.empty.body')}
          product="crm"
          action={
            active.canEdit ? (
              <button type="button" className="btn btn-primary" onClick={() => setDialog('library')}>
                {t('dash.addReport')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {allEmpty && <p className="cdb-nodata">{t('dash.empty.noData')}</p>}
          <div className={`cdb-grid${dragging ? ' is-dragging' : ''}`} data-testid="cdb-grid">
            {active.widgets.map((w, index) => {
              const title = tileTitle(w);
              const data = tiles[w.id];
              const kind = data ? data.kind : 'loading';
              const drop = dropAt?.id === w.id ? (dropAt.after ? ' drop-after' : ' drop-before') : '';
              return (
                <section
                  key={w.id}
                  className={`cdb-tile cdb-tile-${kind}${dragging === w.id ? ' is-dragged' : ''}${drop}`}
                  data-size={sizeFromCols(w.w)}
                  data-tile-id={w.id}
                  data-testid="cdb-tile"
                  aria-label={title}
                >
                  <header className="cdb-tile-head">
                    {active.canEdit && (
                      <button
                        type="button"
                        className="cdb-grip"
                        aria-label={t('dash.tile.drag', { name: title })}
                        data-testid="cdb-grip"
                        onPointerDown={(e) => gripDown(e, w.id)}
                        onPointerMove={gripMove}
                        onPointerUp={gripUp}
                        onPointerCancel={gripCancel}
                        onKeyDown={(e) => gripKey(e, w.id, index)}
                      >
                        <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden>
                          {[2, 7, 12].map((y) => (
                            <g key={y}>
                              <circle cx="2.5" cy={y} r="1.2" />
                              <circle cx="7.5" cy={y} r="1.2" />
                            </g>
                          ))}
                        </svg>
                      </button>
                    )}
                    <div className="cdb-tile-titles">
                      <h2 className="cdb-tile-title dash-widget-title" title={title}>
                        {title}
                      </h2>
                      <p className="cdb-tile-sub">{tileSubtitle(w)}</p>
                    </div>
                    <button
                      type="button"
                      className="cdb-tile-menu"
                      aria-label={t('dash.tile.menu', { name: title })}
                      aria-haspopup="menu"
                      data-testid="cdb-tile-menu"
                      onClick={(e) => openTileMenu(e.currentTarget, w, index)}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                        <circle cx="3" cy="7" r="1.3" />
                        <circle cx="7" cy="7" r="1.3" />
                        <circle cx="11" cy="7" r="1.3" />
                      </svg>
                    </button>
                  </header>
                  <div className="cdb-tile-body">{renderBody(w)}</div>
                </section>
              );
            })}
          </div>
        </>
      )}

      {menu && <ContextMenu anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} />}

      {dialog === 'create' && <CreateDialog t={t} onClose={() => setDialog(null)} onCreate={(body) => void createBoard(body)} />}
      {dialog === 'rename' && active && (
        <NameDialog
          t={t}
          initial={active.name}
          onClose={() => setDialog(null)}
          onSave={async (name) => {
            if (await patchBoard(active.id, { name })) setDialog(null);
          }}
        />
      )}
      {dialog === 'share' && active && (
        <ShareDialog
          t={t}
          board={active}
          teams={teams}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            if (await patchBoard(active.id, body)) setDialog(null);
          }}
        />
      )}
      {editing && (
        <EditTileDialog
          t={t}
          title={cfgOf(editing.config).title ?? ''}
          placeholder={tileTitle(editing)}
          viz={cfgOf(editing.config).viz ?? libraryReport(tileKey(editing))?.viz ?? null}
          vizOptions={libraryReport(tileKey(editing))?.vizOptions ?? []}
          customHref={editing.type === 'custom_report' && cfgOf(editing.config).reportId ? `/app/crm/reports/custom/${cfgOf(editing.config).reportId}` : null}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await patchTile(editing.id, { config: body });
            setDialog(null);
          }}
        />
      )}
      {dialog === 'library' && active && (
        <LibraryDrawer t={t} customReports={customReports} onClose={() => setDialog(null)} onAdd={addTile} onAdded={(msg) => flash(msg)} />
      )}

      <ConfirmDialog
        open={dialog === 'delete' && !!active}
        danger
        title={t('dashboards.confirmDeleteTitle')}
        body={active ? t('dashboards.confirmDelete', { name: active.name, count: active.widgets.length }) : null}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void deleteBoard()}
        onCancel={() => setDialog(null)}
      />

      {drill && (
        <DrillPanel
          t={t}
          drill={drill}
          previewOpen={!!preview}
          fmtValue={fmtValue}
          fmtDate={fmtDate}
          statusLabel={statusLabel}
          onPreview={setPreview}
          onClose={() => {
            const back = drill.returnFocus;
            setDrill(null);
            back?.focus?.();
          }}
        />
      )}
      {preview && <RecordPreview type={preview.type} id={preview.id} locale={locale} onClose={() => setPreview(null)} />}
    </div>
  );
}

type T = ReturnType<typeof useTranslations<'crm'>>;

/**
 * Comparación con el período anterior, como en HubSpot: flecha y cambio en
 * color (subir es bueno en todos los KPIs de la biblioteca), y el valor
 * anterior en gris. Un porcentaje (tasa de cierre) cambia en puntos. Sin
 * datos antes, o con el anterior en cero, no se inventa un porcentaje.
 */
function KpiDelta({
  value,
  prev,
  format,
  fmtValue,
  num,
  t,
}: {
  value: number;
  prev: number | null;
  format: ValueFormat;
  fmtValue: (n: number, f?: ValueFormat) => string;
  num: Intl.NumberFormat;
  t: T;
}) {
  if (prev === null) return <span className="cdb-delta-line cdb-muted" data-testid="cdb-delta">{t('dash.tile.noPrev')}</span>;
  const diff = value - prev;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const prevText = t('dash.tile.vsPrevValue', { value: fmtValue(prev, format === 'moneyPerDay' ? 'money' : format) });
  let change: string | null = null;
  if (format === 'percent') change = t('dash.tile.pts', { value: Math.abs(Math.round(diff * 10) / 10) });
  else if (prev !== 0) change = `${num.format(Math.abs(Math.round((diff / Math.abs(prev)) * 100)))}%`;
  return (
    <span className="cdb-delta-line" data-testid="cdb-delta">
      {dir !== 'flat' && change !== null ? (
        <span className={`cdb-delta is-${dir}`}>
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden className="cdb-delta-arrow">
            <path d={dir === 'up' ? 'M5 1 9.5 8.5H.5Z' : 'M5 9 .5 1.5h9Z'} />
          </svg>
          <span className="sr-only">{dir === 'up' ? '+' : '−'}</span>
          {change}
        </span>
      ) : dir === 'flat' && prev !== 0 ? (
        <span className="cdb-delta is-flat">{format === 'percent' ? t('dash.tile.pts', { value: 0 }) : '0%'}</span>
      ) : null}
      <span className="cdb-muted">{prevText}</span>
    </span>
  );
}

function VisibilityIcon({ visibility }: { visibility: DashboardVisibility }) {
  // Candado (privado), dos personas (equipo) o un globo (todo el workspace).
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="cdb-meta-icon">
      {visibility === 'private' ? (
        <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      ) : visibility === 'team' ? (
        <path d="M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 13.5c.4-2.4 2.2-4 4.5-4s4.1 1.6 4.5 4M11 2.8a2.3 2.3 0 0 1 0 4.4M12.5 9.8c1 .6 1.8 1.8 2 3.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      ) : (
        <path d="M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13ZM1.5 8h13M8 1.5c1.8 2 2.6 4.1 2.6 6.5S9.8 12.5 8 14.5C6.2 12.5 5.4 10.4 5.4 8S6.2 3.5 8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      )}
    </svg>
  );
}

function RecordLink({ row, onPreview }: { row: DrillRow; onPreview: (p: PreviewTarget) => void }) {
  const name = row.name || '…';
  if (row.previewType && row.previewId) {
    const target: PreviewTarget = { type: row.previewType, id: row.previewId };
    return (
      <button type="button" className="cdb-rec-name" data-testid="cdb-record" onClick={() => onPreview(target)}>
        {name}
      </button>
    );
  }
  if (row.href) {
    return (
      <Link href={row.href} className="cdb-rec-name" data-testid="cdb-record">
        {name}
      </Link>
    );
  }
  return <span className="cdb-rec-name">{name}</span>;
}

function SwitcherPanel({
  panelRef,
  boards,
  activeId,
  onPick,
  onCreate,
  t,
  visibilityLabel,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  boards: DashboardView[];
  activeId: string | null;
  onPick: (id: string) => void;
  onCreate: () => void;
  t: T;
  visibilityLabel: (b: DashboardView) => string;
}) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(() => Math.max(0, boards.findIndex((b) => b.id === activeId)));
  const list = boards.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase()));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="cdb-switcher-panel" ref={panelRef} role="dialog" aria-label={t('dash.switcher.label')} data-testid="cdb-switcher-panel">
      <input
        ref={inputRef}
        className="input cdb-switcher-search"
        placeholder={t('dash.switcher.searchPh')}
        aria-label={t('dash.switcher.searchPh')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setCursor(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(list.length - 1, c + 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          }
          if (e.key === 'Enter' && list[cursor]) {
            e.preventDefault();
            onPick(list[cursor].id);
          }
        }}
      />
      <ul className="cdb-switcher-list" aria-label={t('dashboards.title')}>
        {list.map((b, i) => (
          <li key={b.id}>
            <button
              type="button"
              className={`cdb-switcher-item${i === cursor ? ' is-cursor' : ''}${b.id === activeId ? ' is-active' : ''}`}
              aria-current={b.id === activeId ? 'true' : undefined}
              onClick={() => onPick(b.id)}
              onMouseEnter={() => setCursor(i)}
            >
              <span className="cdb-switcher-item-name">{b.name}</span>
              <span className="cdb-switcher-item-meta">
                {b.isDefault ? `${t('dash.switcher.default')} · ` : ''}
                {visibilityLabel(b)}
              </span>
            </button>
          </li>
        ))}
        {!list.length && <li className="cdb-muted cdb-switcher-none">{t('dash.switcher.noMatch')}</li>}
      </ul>
      <button type="button" className="cdb-switcher-create" onClick={onCreate}>
        + {t('dash.switcher.create')}
      </button>
    </div>
  );
}

/** <dialog class="ui-modal"> con foco atrapado, Esc y clic en el telón para cerrar. */
function Modal({ title, onClose, children, foot, testId }: { title: string; onClose: () => void; children: ReactNode; foot: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const back = focusBack();
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => back?.focus?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-label={title}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-modal-head">
        <h2 className="ui-modal-title">{title}</h2>
      </div>
      <div className="ui-modal-body">{children}</div>
      <div className="ui-modal-foot">{foot}</div>
    </dialog>
  );
}

function CreateDialog({ t, onClose, onCreate }: { t: T; onClose: () => void; onCreate: (b: { name: string; template: 'blank' | 'sales' }) => void }) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<'blank' | 'sales'>('sales');
  return (
    <Modal
      title={t('dash.create.title')}
      onClose={onClose}
      testId="cdb-create"
      foot={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('dash.create.cancel')}
          </button>
          <button type="submit" form="cdb-create-form" className="btn btn-sm btn-primary" disabled={!name.trim()}>
            {t('dash.create.submit')}
          </button>
        </>
      }
    >
      <form
        id="cdb-create-form"
        className="cdb-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onCreate({ name: name.trim(), template });
        }}
      >
        <label className="ui-field">
          <span className="label">{t('dash.create.name')}</span>
          <input className="input" autoFocus maxLength={200} value={name} placeholder={t('dash.create.namePh')} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="cdb-choice">
          <legend className="label">{t('dash.create.startWith')}</legend>
          {(['sales', 'blank'] as const).map((k) => (
            <label key={k} className={`cdb-choice-item${template === k ? ' is-on' : ''}`}>
              <input type="radio" name="cdb-template" value={k} checked={template === k} onChange={() => setTemplate(k)} />
              <span className="cdb-choice-text">
                <strong>{t(`dash.create.${k}`)}</strong>
                <span className="cdb-muted">{t(`dash.create.${k}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}

function NameDialog({ t, initial, onClose, onSave }: { t: T; initial: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <Modal
      title={t('dash.rename.title')}
      onClose={onClose}
      testId="cdb-rename"
      foot={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('dash.create.cancel')}
          </button>
          <button type="submit" form="cdb-name-form" className="btn btn-sm btn-primary" disabled={!name.trim()}>
            {t('dash.rename.save')}
          </button>
        </>
      }
    >
      <form
        id="cdb-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <label className="ui-field">
          <span className="label">{t('dash.create.name')}</span>
          <input className="input" autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </label>
      </form>
    </Modal>
  );
}

function ShareDialog({
  t,
  board,
  teams,
  onClose,
  onSave,
}: {
  t: T;
  board: DashboardView;
  teams: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (b: { visibility: DashboardVisibility; teamId: string | null; access: DashboardAccess }) => void;
}) {
  const [visibility, setVisibility] = useState<DashboardVisibility>(board.visibility as DashboardVisibility);
  const [teamId, setTeamId] = useState<string>(board.team_id ?? teams[0]?.id ?? '');
  const [access, setAccess] = useState<DashboardAccess>(board.access === 'view' ? 'view' : 'edit');
  const canSave = visibility !== 'team' || !!teamId;
  return (
    <Modal
      title={t('dash.share.title')}
      onClose={onClose}
      testId="cdb-share"
      foot={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('dash.create.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!canSave}
            onClick={() => onSave({ visibility, teamId: visibility === 'team' ? teamId : null, access })}
          >
            {t('dash.share.save')}
          </button>
        </>
      }
    >
      <div className="cdb-form">
        <fieldset className="cdb-choice">
          <legend className="label">{t('dash.share.who')}</legend>
          {(['private', 'team', 'everyone'] as const).map((v) => (
            <label key={v} className={`cdb-choice-item${visibility === v ? ' is-on' : ''}`}>
              <input type="radio" name="cdb-vis" value={v} checked={visibility === v} disabled={(v === 'team' && !teams.length) || (v === 'private' && !board.isOwner)} onChange={() => setVisibility(v)} />
              <span>{v === 'team' ? t('dash.visibility.teamPlain') : t(`dash.visibility.${v}`)}</span>
            </label>
          ))}
        </fieldset>
        {visibility === 'team' && (
          <label className="ui-field">
            <span className="label">{t('dash.share.team')}</span>
            <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {teams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!teams.length && <p className="ui-help">{t('dash.share.noTeams')}</p>}
        {visibility !== 'private' && (
          <fieldset className="cdb-choice">
            <legend className="label">{t('dash.share.what')}</legend>
            {(['view', 'edit'] as const).map((v) => (
              <label key={v} className={`cdb-choice-item${access === v ? ' is-on' : ''}`}>
                <input type="radio" name="cdb-access" value={v} checked={access === v} onChange={() => setAccess(v)} />
                <span>{t(`dash.access.${v}`)}</span>
              </label>
            ))}
          </fieldset>
        )}
        <p className="ui-help">{t('dash.share.hint')}</p>
      </div>
    </Modal>
  );
}

function EditTileDialog({
  t,
  title,
  placeholder,
  viz,
  vizOptions,
  customHref,
  onClose,
  onSave,
}: {
  t: T;
  title: string;
  placeholder: string;
  viz: TileViz | null;
  vizOptions: TileViz[];
  customHref: string | null;
  onClose: () => void;
  onSave: (b: { title: string; viz?: TileViz }) => void;
}) {
  const [name, setName] = useState(title);
  const [v, setV] = useState<TileViz | null>(viz);
  return (
    <Modal
      title={t('dash.edit.title')}
      onClose={onClose}
      testId="cdb-edit"
      foot={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('dash.edit.cancel')}
          </button>
          <button type="submit" form="cdb-edit-form" className="btn btn-sm btn-primary">
            {t('dash.edit.save')}
          </button>
        </>
      }
    >
      <form
        id="cdb-edit-form"
        className="cdb-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ title: name.trim(), ...(v && vizOptions.length > 1 ? { viz: v } : {}) });
        }}
      >
        <label className="ui-field">
          <span className="label">{t('dash.edit.name')}</span>
          <input className="input" autoFocus maxLength={120} value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
        </label>
        {vizOptions.length > 1 && (
          <fieldset className="cdb-choice cdb-viz-choice">
            <legend className="label">{t('dash.edit.viz')}</legend>
            {vizOptions.map((o) => (
              <label key={o} className={`cdb-choice-item${v === o ? ' is-on' : ''}`}>
                <input type="radio" name="cdb-viz" value={o} checked={v === o} onChange={() => setV(o)} />
                <span>{t(`dash.viz.${o}`)}</span>
              </label>
            ))}
          </fieldset>
        )}
        {customHref && (
          <p className="ui-help">
            <Link href={customHref}>{t('dash.tile.openReport')}</Link>
          </p>
        )}
      </form>
    </Modal>
  );
}

function LibraryDrawer({
  t,
  customReports,
  onClose,
  onAdd,
  onAdded,
}: {
  t: T;
  customReports: Array<{ id: string; name: string }>;
  onClose: () => void;
  onAdd: (b: Record<string, unknown>) => Promise<boolean>;
  onAdded: (msg: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'all' | 'mine' | (typeof REPORT_CATEGORIES)[number]>('all');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const back = focusBack();
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => back?.focus?.();
  }, []);
  const query = q.trim().toLowerCase();
  const lib = cat === 'mine' ? [] : LIBRARY.filter((r) => (cat === 'all' || r.category === cat) && (!query || `${t(`dash.reports.${r.key}.name`)} ${t(`dash.reports.${r.key}.desc`)}`.toLowerCase().includes(query)));
  const mine = cat === 'all' || cat === 'mine' ? customReports.filter((r) => !query || r.name.toLowerCase().includes(query)) : [];

  async function add(id: string, body: Record<string, unknown>) {
    setBusy(id);
    const ok = await onAdd(body);
    setBusy(null);
    if (ok) {
      setAdded((s) => new Set(s).add(id));
      onAdded(t('dash.library.added'));
    }
  }

  const item = (id: string, name: string, desc: string | null, meta: string, body: Record<string, unknown>, report?: string) => (
    <li key={id} className="cdb-lib-item" data-testid="cdb-lib-item" data-report={report}>
      <div className="cdb-lib-text">
        <span className="cdb-lib-name">{name}</span>
        {desc && <span className="cdb-lib-desc">{desc}</span>}
        <span className="cdb-lib-meta">{meta}</span>
      </div>
      <button type="button" className="btn btn-sm" disabled={busy === id} aria-label={`${t('dash.library.add')}: ${name}`} onClick={() => void add(id, body)}>
        {added.has(id) ? `✓ ${t('dash.library.added')}` : t('dash.library.add')}
      </button>
    </li>
  );

  return (
    <dialog
      ref={ref}
      className="ui-drawer cdb-library"
      aria-label={t('dash.library.title')}
      data-testid="cdb-library"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-drawer-head">
        <h2 className="ui-drawer-title">{t('dash.library.title')}</h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          {t('dash.drill.close')}
        </button>
      </div>
      <div className="ui-drawer-body cdb-lib-body">
        <input className="input" autoFocus placeholder={t('dash.library.searchPh')} aria-label={t('dash.library.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="cdb-lib-cats" role="group" aria-label={t('dash.library.title')}>
          {(['all', ...REPORT_CATEGORIES, 'mine'] as const).map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} className={`cdb-lib-cat${cat === c ? ' is-on' : ''}`} onClick={() => setCat(c)}>
              {c === 'all' ? t('dash.library.all') : c === 'mine' ? t('dash.library.mine') : t(`dash.library.categories.${c}`)}
            </button>
          ))}
        </div>
        <ul className="cdb-lib-list">
          {lib.map((r) =>
            item(
              r.key,
              t(`dash.reports.${r.key}.name`),
              t(`dash.reports.${r.key}.desc`),
              `${t(`dash.library.categories.${r.category}`)} · ${t(`dash.viz.${r.viz}`)}`,
              { type: 'library', config: { reportKey: r.key } },
              r.key,
            ),
          )}
          {mine.map((r) => item(r.id, r.name, null, t('dash.library.mine'), { type: 'custom_report', config: { reportId: r.id } }))}
          {cat === 'mine' && !mine.length && <li className="cdb-muted cdb-lib-none">{t('dash.library.noCustom')}</li>}
          {cat !== 'mine' && !lib.length && !mine.length && <li className="cdb-muted cdb-lib-none">{t('dash.library.noResults')}</li>}
        </ul>
      </div>
      <div className="ui-drawer-foot">
        <Link href="/app/crm/reports/custom/new" className="btn btn-sm">
          {t('dash.library.createCustom')}
        </Link>
      </div>
    </dialog>
  );
}

function DrillPanel({
  t,
  drill,
  previewOpen,
  fmtValue,
  fmtDate,
  statusLabel,
  onPreview,
  onClose,
}: {
  t: T;
  drill: DrillState;
  previewOpen: boolean;
  fmtValue: (n: number, f?: ValueFormat) => string;
  fmtDate: (iso: string | null) => string;
  statusLabel: (r: DrillRow) => string;
  onPreview: (p: PreviewTarget) => void;
  onClose: () => void;
}) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const previewRef = useRef(previewOpen);
  previewRef.current = previewOpen;
  useEffect(() => {
    closeBtn.current?.focus();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Con la vista previa de un registro abierta, Esc cierra solo esa.
      if (previewRef.current) return;
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !panel.current?.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !panel.current?.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const res = drill.result;
  const statusHead =
    res?.object === 'deal' ? t('dash.drill.cols.stage') : res?.object === 'activity' ? t('dash.drill.cols.type') : res?.object === 'company' ? t('dash.drill.cols.lifecycle') : t('dash.drill.cols.status');
  return (
    <div
      className="cdb-drill-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !previewRef.current) onClose();
      }}
    >
      <div className="cdb-drill" ref={panel} role="dialog" aria-modal="true" aria-label={drill.title} data-testid="cdb-drill">
        <div className="cdb-drill-head">
          <div className="cdb-drill-titles">
            <h2 className="cdb-drill-title">{drill.title}</h2>
            {drill.subtitle && <p className="cdb-tile-sub">{drill.subtitle}</p>}
            {res && (
              <p className="cdb-drill-count" data-testid="cdb-drill-count">
                {t('dash.tile.records', { count: res.total })}
                {res.sum !== null ? ` · ${t('dash.drill.sum')}: ${fmtValue(res.sum, 'money')}` : ''}
              </p>
            )}
          </div>
          <button ref={closeBtn} type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            {t('dash.drill.close')}
          </button>
        </div>
        <div className="cdb-drill-body">
          {drill.status === 'loading' && (
            <div className="cdb-skeleton" aria-busy="true" aria-label={t('dash.tile.loading')}>
              <span />
              <span />
              <span />
            </div>
          )}
          {drill.status === 'error' && <p className="cdb-empty">{t('dash.tile.error')}</p>}
          {res && !res.rows.length && <p className="cdb-empty">{t('dash.drill.empty')}</p>}
          {res && res.rows.length > 0 && (
            <table className="table cdb-drill-table">
              <thead>
                <tr>
                  <th scope="col">{t('dash.drill.cols.name')}</th>
                  {res.object === 'deal' && (
                    <th scope="col" className="num">
                      {t('dash.drill.cols.amount')}
                    </th>
                  )}
                  <th scope="col">{statusHead}</th>
                  <th scope="col" className="cdb-col-owner">
                    {t('dash.drill.cols.owner')}
                  </th>
                  <th scope="col">{t('dash.drill.cols.date')}</th>
                </tr>
              </thead>
              <tbody>
                {res.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <RecordLink row={r} onPreview={onPreview} />
                    </td>
                    {res.object === 'deal' && <td className="num">{r.amount !== null ? fmtValue(r.amount, 'money') : ''}</td>}
                    <td>{statusLabel(r)}</td>
                    <td className="cdb-col-owner">{r.owner ?? ''}</td>
                    <td className="cdb-nowrap">{fmtDate(r.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {res?.truncated && <p className="cdb-muted">{t('dash.drill.truncated', { count: res.rows.length })}</p>}
        </div>
      </div>
    </div>
  );
}
