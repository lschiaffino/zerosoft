'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { CrmDashboardWidgetRow } from '@/lib/db';
import type { CrmDashboardWithWidgets } from '@/lib/crm-dashboards';
import {
  DASHBOARD_MENU_TYPES,
  KPI_METRICS,
  WIDGET_MIN_SIZE,
  type DashboardInitialData,
  type DashboardWidgetConfig,
  type DashboardWidgetType,
  type KpiMetric,
  type WidgetDataMap,
} from '@/lib/crm-dashboards-schema';
import { formatAxis, formatDate, formatNumber } from '@/lib/utils';
import { Link } from '@/i18n/navigation';
import ReportChart from './ReportChart';
import { bucketLabel, monthLabel } from '@/lib/crm-buckets';

const GRID_COLS = 12;
const ROW_H = 64; // px por fila del grid (ver .dash-grid en crm.css)
const GRID_GAP = 16;
const DRAG_THRESHOLD = 6; // px antes de activar el drag (permite clicks normales)
const DEFAULT_RANGE = '30d';

interface DashboardsViewProps {
  dashboards: CrmDashboardWithWidgets[];
  pipelines: Array<{ id: string; name: string }>;
  defaultPipelineId: string | null;
  initialData: DashboardInitialData;
  locale: string;
  /** Moneda base del workspace (montos convertidos). */
  baseCurrency?: string;
  /** Monedas usadas sin tipo de cambio (se suman 1:1). */
  missingRates?: string[];
}

interface DragState {
  pointerId: number;
  widgetId: string;
  widgetType: DashboardWidgetType;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  dragging: boolean;
  cardEl: HTMLElement | null;
  ghostEl: HTMLElement | null;
  offsetX: number;
  offsetY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  targetX: number;
  targetY: number;
  targetW: number;
  targetH: number;
}

interface LItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

type DataState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: WidgetDataMap[DashboardWidgetType] };

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function parseConfig(raw: string): DashboardWidgetConfig {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as DashboardWidgetConfig) : {};
  } catch {
    return {};
  }
}

/** Montos de reportes: siempre en la moneda base del workspace (los deals se convierten en SQL). */
function formatMoney(n: number, locale: string, currency = 'USD'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function niceCeil(max: number): number {
  if (max <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}


// ---------- Layout: resolución de colisiones (empuja hacia abajo) ----------

function collides(a: LItem, b: LItem): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Coloca items en orden; el primero queda fijo y el resto baja si choca. */
function placeAll(items: LItem[]): LItem[] {
  const placed: LItem[] = [];
  for (const item of items) {
    const next = { ...item };
    while (placed.some((p) => collides(next, p))) next.y += 1;
    placed.push(next);
  }
  return placed;
}

/** Layout tras mover/redimensionar un widget, con position = orden de lectura. */
function layoutAfterChange(
  widgets: CrmDashboardWidgetRow[],
  movedId: string,
  target: { x: number; y: number; w: number; h: number },
): Array<LItem & { position: number }> {
  const rest = widgets
    .filter((w) => w.id !== movedId)
    .map((w) => ({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = placeAll([{ id: movedId, ...target }, ...rest]);
  return [...placed]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item, i) => ({ ...item, position: i }));
}

// ---------- Charts inline (SVG, monocromo, sin deps) ----------

function TimeseriesChart({
  data,
  locale,
  labels,
}: {
  data: WidgetDataMap['timeseries']['timeseries'];
  locale: string;
  labels: { contacts: string; deals: string; ariaLabel: string };
}) {
  const W = 560;
  const H = 190;
  const pad = { t: 10, r: 8, b: 22, l: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const baseline = pad.t + ih;

  // Conteos: máximo múltiplo de 3 (tres tramos) para que el eje marque enteros (0, 1, 2, 3), no 3.3.
  const max = Math.max(3, Math.ceil(niceCeil(Math.max(...data.map((d) => Math.max(d.contacts, d.deals)), 1)) / 3) * 3);
  const stepX = data.length > 0 ? iw / data.length : iw;
  const bw = Math.min(9, stepX / 4);
  const labelEvery = Math.max(1, Math.ceil(36 / Math.max(stepX, 1)));

  return (
    <>
      <svg
        className="link-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={labels.ariaLabel}
        preserveAspectRatio="none"
      >
        {[0, 1, 2, 3].map((k) => {
          const value = (max * k) / 3;
          const y = pad.t + ih - (value / max) * ih;
          return (
            <g key={k}>
              <line className="chart-grid" x1={pad.l} x2={pad.l + iw} y1={y} y2={y} />
              <text className="chart-ylabel" x={pad.l - 6} y={y + 4} textAnchor="end">
                {formatAxis(value, locale)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const cx = pad.l + stepX * (i + 0.5);
          const cH = (d.contacts / max) * ih;
          const dH = (d.deals / max) * ih;
          return (
            <g key={d.bucket}>
              {d.contacts > 0 && (
                <rect
                  className="chart-bar"
                  x={cx - bw - 1}
                  y={baseline - cH}
                  width={bw}
                  height={cH}
                >
                  <title>{`${bucketLabel(d.bucket, locale)} · ${labels.contacts}: ${d.contacts}`}</title>
                </rect>
              )}
              {d.deals > 0 && (
                <rect
                  className="chart-bar-lost"
                  x={cx + 1}
                  y={baseline - dH}
                  width={bw}
                  height={dH}
                >
                  <title>{`${bucketLabel(d.bucket, locale)} · ${labels.deals}: ${d.deals}`}</title>
                </rect>
              )}
              {i % labelEvery === 0 && (
                <text className="chart-xlabel" x={cx} y={H - 6} textAnchor="middle">
                  {bucketLabel(d.bucket, locale)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="chart-legend mono">
        <span className="legend-item">
          <span className="legend-swatch" aria-hidden /> {labels.contacts}
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-lost" aria-hidden /> {labels.deals}
        </span>
      </p>
    </>
  );
}

function WonLostChart({
  data,
  locale,
  labels,
}: {
  data: WidgetDataMap['wonlost']['wonLost'];
  locale: string;
  labels: { won: string; lost: string; ariaLabel: string };
}) {
  const W = 560;
  const H = 190;
  const pad = { t: 10, r: 8, b: 22, l: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const baseline = pad.t + ih;

  const max = Math.max(3, Math.ceil(niceCeil(Math.max(...data.map((d) => Math.max(d.won, d.lost)), 0)) / 3) * 3);
  const stepX = data.length > 0 ? iw / data.length : iw;
  const bw = Math.min(14, stepX / 4);

  return (
    <>
      <svg
        className="link-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={labels.ariaLabel}
        preserveAspectRatio="none"
      >
        {[0, 1, 2, 3].map((k) => {
          const value = (max * k) / 3;
          const y = pad.t + ih - (value / max) * ih;
          return (
            <g key={k}>
              <line className="chart-grid" x1={pad.l} x2={pad.l + iw} y1={y} y2={y} />
              <text className="chart-ylabel" x={pad.l - 6} y={y + 4} textAnchor="end">
                {formatAxis(value, locale)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const cx = pad.l + stepX * (i + 0.5);
          const wH = (d.won / max) * ih;
          const lH = (d.lost / max) * ih;
          return (
            <g key={d.month}>
              {d.won > 0 && (
                <rect className="chart-bar" x={cx - bw - 2} y={baseline - wH} width={bw} height={wH}>
                  <title>{`${monthLabel(d.month, locale)} · ${labels.won}: ${d.won}`}</title>
                </rect>
              )}
              {d.lost > 0 && (
                <rect
                  className="chart-bar-lost"
                  x={cx + 2}
                  y={baseline - lH}
                  width={bw}
                  height={lH}
                >
                  <title>{`${monthLabel(d.month, locale)} · ${labels.lost}: ${d.lost}`}</title>
                </rect>
              )}
              <text className="chart-xlabel" x={cx} y={H - 6} textAnchor="middle">
                {monthLabel(d.month, locale)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="chart-legend mono">
        <span className="legend-item">
          <span className="legend-swatch" aria-hidden /> {labels.won}
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-lost" aria-hidden /> {labels.lost}
        </span>
      </p>
    </>
  );
}

// ---------- View ----------

export default function DashboardsView({
  baseCurrency = 'USD',
  missingRates = [],
  dashboards,
  pipelines,
  defaultPipelineId,
  initialData,
  locale,
}: DashboardsViewProps) {
  const t = useTranslations('crm.dashboards');
  const tc = useTranslations('crm');
  const tCrm = useTranslations('crm');

  const [boards, setBoards] = useState<CrmDashboardWithWidgets[]>(dashboards);
  const [activeId, setActiveId] = useState<string>(dashboards[0]?.id ?? '');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameValue, setRenameValue] = useState(dashboards[0]?.name ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, WidgetDataMap[DashboardWidgetType] | null>>({});

  const dragRef = useRef<DragState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<Set<string>>(new Set());

  const active = boards.find((b) => b.id === activeId) ?? null;

  // Sync del input de rename al cambiar de dashboard o de nombre.
  useEffect(() => {
    setRenameValue(active?.name ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, active?.name]);

  // Cierra el menú "Add widget" al clickar fuera.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Limpieza del DOM de drag si el componente se desmonta a mitad de un drag.
  useEffect(() => {
    return () => {
      cleanupDragDom(dragRef.current);
      dragRef.current = null;
    };
  }, []);

  // ---------- Data por widget ----------

  /** Widgets con config no-default se fetchean a /api/crm/dashboards/data. */
  function needsCustomData(w: CrmDashboardWidgetRow): boolean {
    const cfg = parseConfig(w.config);
    if (w.type === 'custom_report') return true;
    if (w.type === 'funnel' || w.type === 'forecast') {
      return !!cfg.pipelineId && cfg.pipelineId !== defaultPipelineId;
    }
    if (['kpi', 'timeseries', 'source', 'owner', 'leaderboard'].includes(w.type)) {
      return !!cfg.range && cfg.range !== DEFAULT_RANGE;
    }
    return false;
  }

  function dataStateFor(w: CrmDashboardWidgetRow): DataState {
    if (!needsCustomData(w)) {
      return { status: 'ready', data: initialData[w.type as DashboardWidgetType] };
    }
    const cached = cache[`${w.id}:${w.config}`];
    if (cached === undefined) return { status: 'loading' };
    if (cached === null) return { status: 'error' };
    return { status: 'ready', data: cached };
  }

  // Fetch de datasets custom (config ≠ default) de los widgets visibles.
  useEffect(() => {
    if (!active) return;
    for (const w of active.widgets) {
      if (!needsCustomData(w)) continue;
      const key = `${w.id}:${w.config}`;
      if (cache[key] !== undefined || pendingRef.current.has(key)) continue;
      pendingRef.current.add(key);
      const cfg = parseConfig(w.config);
      fetch('/api/crm/dashboards/data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: w.type,
          pipelineId: cfg.pipelineId ?? defaultPipelineId,
          range: cfg.range ?? DEFAULT_RANGE,
          reportId: cfg.reportId,
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('bad status');
          const data = (await res.json()) as WidgetDataMap[DashboardWidgetType];
          setCache((prev) => ({ ...prev, [key]: data }));
        })
        .catch(() => {
          setCache((prev) => ({ ...prev, [key]: null }));
        })
        .finally(() => {
          pendingRef.current.delete(key);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, activeId, cache]);

  // ---------- Mutations ----------

  async function submitCreate() {
    const name = newName.trim();
    setCreating(false);
    setNewName('');
    if (!name) return;
    setError(null);
    const res = await fetch('/api/crm/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (res && res.ok) {
      const dash = (await res.json()) as CrmDashboardWithWidgets;
      setBoards((prev) => [...prev, dash]);
      setActiveId(dash.id);
    } else {
      setError(tCrm('errors.generic'));
    }
  }

  async function submitRename() {
    if (!active) return;
    const name = renameValue.trim();
    if (!name || name === active.name) {
      setRenameValue(active.name);
      return;
    }
    setError(null);
    const snapshot = boards;
    setBoards((prev) => prev.map((b) => (b.id === active.id ? { ...b, name } : b)));
    const res = await fetch(`/api/crm/dashboards/${active.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setBoards(snapshot);
      setError(tCrm('errors.generic'));
    }
  }

  async function confirmDeleteDashboard() {
    if (!active) return;
    setConfirmingDelete(false);
    setError(null);
    const snapshot = boards;
    const remaining = boards.filter((b) => b.id !== active.id);
    setBoards(remaining);
    setActiveId(remaining[0]?.id ?? '');
    const res = await fetch(`/api/crm/dashboards/${active.id}`, { method: 'DELETE' }).catch(
      () => null,
    );
    if (!res || !res.ok) {
      setBoards(snapshot);
      setActiveId(active.id);
      setError(tCrm('errors.generic'));
    }
  }

  async function addNewWidget(type: DashboardWidgetType) {
    setAddMenuOpen(false);
    if (!active) return;
    setError(null);
    const res = await fetch(`/api/crm/dashboards/${active.id}/widgets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type }),
    }).catch(() => null);
    if (res && res.ok) {
      const widget = (await res.json()) as CrmDashboardWidgetRow;
      setBoards((prev) =>
        prev.map((b) => (b.id === active.id ? { ...b, widgets: [...b.widgets, widget] } : b)),
      );
    } else {
      setError(tCrm('errors.generic'));
    }
  }

  async function removeWidget(widget: CrmDashboardWidgetRow) {
    if (!active) return;
    setError(null);
    const snapshot = boards;
    setBoards((prev) =>
      prev.map((b) =>
        b.id === active.id ? { ...b, widgets: b.widgets.filter((w) => w.id !== widget.id) } : b,
      ),
    );
    const res = await fetch(`/api/crm/dashboards/widgets/${widget.id}`, {
      method: 'DELETE',
    }).catch(() => null);
    if (!res || !res.ok) {
      setBoards(snapshot);
      setError(tCrm('errors.generic'));
    }
  }

  async function changeConfig(widget: CrmDashboardWidgetRow, config: DashboardWidgetConfig) {
    if (!active) return;
    setError(null);
    const snapshot = boards;
    setBoards((prev) =>
      prev.map((b) =>
        b.id === active.id
          ? {
              ...b,
              widgets: b.widgets.map((w) =>
                w.id === widget.id ? { ...w, config: JSON.stringify(config) } : w,
              ),
            }
          : b,
      ),
    );
    const res = await fetch(`/api/crm/dashboards/widgets/${widget.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setBoards(snapshot);
      setError(tCrm('errors.generic'));
    }
  }

  // ---------- Drag & drop (pointer events, sin deps; patrón de DealsBoard) ----------

  function cleanupDragDom(d: DragState | null) {
    if (!d) return;
    d.ghostEl?.remove();
    d.cardEl?.classList.remove('dragging');
    if (previewRef.current) previewRef.current.style.display = 'none';
  }

  function handleGripDown(
    e: ReactPointerEvent<HTMLElement>,
    widget: CrmDashboardWidgetRow,
    mode: 'move' | 'resize',
  ) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // En <960px el grid colapsa a columna: el drag por celdas no aplica.
    if (window.matchMedia('(max-width: 960px)').matches) return;
    const target = e.target as HTMLElement;
    // Elementos interactivos dentro del header no inician drag.
    if (mode === 'move' && target.closest('a, button, select, input, textarea, [data-no-drag]')) {
      return;
    }
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    dragRef.current = {
      pointerId: e.pointerId,
      widgetId: widget.id,
      widgetType: widget.type as DashboardWidgetType,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      cardEl: handle.closest('.dash-widget'),
      ghostEl: null,
      offsetX: 0,
      offsetY: 0,
      origX: widget.x,
      origY: widget.y,
      origW: widget.w,
      origH: widget.h,
      targetX: widget.x,
      targetY: widget.y,
      targetW: widget.w,
      targetH: widget.h,
    };
  }

  function gridMetrics(): { rect: DOMRect; stepX: number; stepY: number } | null {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const colW = (rect.width - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
    return { rect, stepX: colW + GRID_GAP, stepY: ROW_H + GRID_GAP };
  }

  function startDrag(d: DragState, e: ReactPointerEvent<HTMLElement>) {
    d.dragging = true;
    const cardEl = d.cardEl;
    if (cardEl) {
      const rect = cardEl.getBoundingClientRect();
      d.offsetX = e.clientX - rect.left;
      d.offsetY = e.clientY - rect.top;
      if (d.mode === 'move') {
        const ghost = cardEl.cloneNode(true) as HTMLElement;
        ghost.classList.add('dash-widget-ghost');
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        document.body.appendChild(ghost);
        d.ghostEl = ghost;
      }
      cardEl.classList.add('dragging');
    }
  }

  function updateDrag(d: DragState, e: ReactPointerEvent<HTMLElement>) {
    const m = gridMetrics();
    if (!m) return;
    if (d.mode === 'move') {
      if (d.ghostEl) {
        d.ghostEl.style.left = `${e.clientX - d.offsetX}px`;
        d.ghostEl.style.top = `${e.clientY - d.offsetY}px`;
      }
      const left = e.clientX - d.offsetX - m.rect.left;
      const top = e.clientY - d.offsetY - m.rect.top;
      d.targetX = clamp(Math.round(left / m.stepX), 0, GRID_COLS - d.origW);
      d.targetY = clamp(Math.round(top / m.stepY), 0, 999);
    } else {
      const min = WIDGET_MIN_SIZE[d.widgetType];
      const dw = Math.round((e.clientX - d.startX) / m.stepX);
      const dh = Math.round((e.clientY - d.startY) / m.stepY);
      d.targetW = clamp(d.origW + dw, min.w, GRID_COLS - d.origX);
      d.targetH = clamp(d.origH + dh, min.h, 24);
    }
    const preview = previewRef.current;
    if (preview) {
      preview.style.display = 'block';
      preview.style.left = `${d.targetX * m.stepX}px`;
      preview.style.top = `${d.targetY * m.stepY}px`;
      preview.style.width = `${d.targetW * m.stepX - GRID_GAP}px`;
      preview.style.height = `${d.targetH * m.stepY - GRID_GAP}px`;
    }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.dragging) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      startDrag(d, e);
    }
    updateDrag(d, e);
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.dragging) finishDrag(d);
    cleanupDragDom(d);
    dragRef.current = null;
  }

  function handlePointerCancel(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    cleanupDragDom(d);
    dragRef.current = null;
  }

  function finishDrag(d: DragState) {
    if (!active) return;
    const unchanged =
      d.targetX === d.origX && d.targetY === d.origY && d.targetW === d.origW && d.targetH === d.origH;
    if (unchanged) return;
    const layout = layoutAfterChange(active.widgets, d.widgetId, {
      x: d.targetX,
      y: d.targetY,
      w: d.targetW,
      h: d.targetH,
    });
    void persistLayout(layout);
  }

  async function persistLayout(layout: Array<LItem & { position: number }>) {
    if (!active) return;
    setError(null);
    const snapshot = boards;
    setBoards((prev) =>
      prev.map((b) =>
        b.id === active.id
          ? {
              ...b,
              widgets: b.widgets
                .map((w) => {
                  const item = layout.find((l) => l.id === w.id);
                  return item
                    ? { ...w, x: item.x, y: item.y, w: item.w, h: item.h, position: item.position }
                    : w;
                })
                .sort((a, b) => a.position - b.position),
            }
          : b,
      ),
    );
    const res = await fetch(`/api/crm/dashboards/${active.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setBoards(snapshot);
      setError(tCrm('errors.generic'));
    }
  }

  // ---------- Widget bodies ----------

  function widgetTitle(w: CrmDashboardWidgetRow): string {
    const cfg = parseConfig(w.config);
    if (w.type === 'kpi') return tCrm(`reports.kpi.${cfg.metric ?? 'newContacts'}`);
    if (w.type === 'custom_report') {
      const state = dataStateFor(w);
      const report = state.status === 'ready' ? (state.data as WidgetDataMap['custom_report']).report : null;
      return report?.name ?? t('widgets.custom_report');
    }
    return t(`widgets.${w.type}`);
  }

  function renderBody(w: CrmDashboardWidgetRow): ReactNode {
    const state = dataStateFor(w);
    if (state.status === 'loading') return <p className="muted dash-loading">{t('loading')}</p>;
    if (state.status === 'error') return <p className="muted dash-loading">{t('loadError')}</p>;
    const data = state.data;
    const empty = <p className="muted breakdown-empty">{t('emptyData')}</p>;

    switch (w.type as DashboardWidgetType) {
      case 'kpi': {
        const { kpis } = data as WidgetDataMap['kpi'];
        const metric = (parseConfig(w.config).metric ?? 'newContacts') as KpiMetric;
        const value = kpis[metric];
        const delta = kpis[`${metric}Delta` as keyof typeof kpis];
        return (
          <div className="dash-kpi">
            <span className="stat-num dash-kpi-value">
              {metric === 'wonAmount' ? formatMoney(value, locale, baseCurrency) : formatNumber(value, locale)}
            </span>
            <span className={`stat-delta ${delta >= 0 ? 'up' : 'down'}`}>
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
            </span>
          </div>
        );
      }
      case 'funnel': {
        const { funnel } = data as WidgetDataMap['funnel'];
        if (funnel.length === 0) return empty;
        const max = Math.max(...funnel.map((s) => s.count), 1);
        return (
          <div className="breakdown">
            {funnel.map((stage) => (
              <div className="breakdown-row funnel-row" key={stage.id}>
                <span className="breakdown-name" title={stage.name}>
                  {stage.name}
                </span>
                <span
                  className="breakdown-track"
                  title={`${formatNumber(stage.count, locale)} · ${formatMoney(stage.amount, locale, baseCurrency)}`}
                >
                  <span
                    className="breakdown-bar"
                    style={{ width: `${Math.max((stage.count / max) * 100, 2)}%` }}
                  />
                </span>
                <span className="funnel-stats mono">
                  {formatNumber(stage.count, locale)}
                  {stage.conversionRate !== null && (
                    <span className="funnel-conv" title={tCrm('reports.vsPrev')}>
                      {stage.conversionRate}%
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        );
      }
      case 'forecast': {
        const { forecast } = data as WidgetDataMap['forecast'];
        if (forecast.length === 0) return empty;
        const total = forecast.reduce((s, f) => s + f.forecast, 0);
        const max = Math.max(...forecast.map((f) => f.forecast), 1);
        return (
          <>
            <div className="report-total">
              <span className="stat-num dash-total-num">{formatMoney(total, locale, baseCurrency)}</span>
              <span className="stat-label">
                {tCrm('reports.total')} · {tCrm('reports.forecast')}
              </span>
            </div>
            <div className="breakdown">
              {forecast.map((stage) => (
                <div className="breakdown-row funnel-row" key={stage.id}>
                  <span className="breakdown-name" title={stage.name}>
                    {stage.name}
                  </span>
                  <span
                    className="breakdown-track"
                    title={`${formatNumber(stage.count, locale)} · ${formatMoney(stage.amount, locale, baseCurrency)}`}
                  >
                    <span
                      className="breakdown-bar"
                      style={{ width: `${Math.max((stage.forecast / max) * 100, 2)}%` }}
                    />
                  </span>
                  <span className="funnel-stats mono">{formatMoney(stage.forecast, locale, baseCurrency)}</span>
                </div>
              ))}
            </div>
          </>
        );
      }
      case 'timeseries': {
        const { timeseries } = data as WidgetDataMap['timeseries'];
        if (timeseries.length === 0) return empty;
        return (
          <TimeseriesChart
            data={timeseries}
            locale={locale}
            labels={{
              contacts: tCrm('reports.contacts'),
              deals: tCrm('reports.deals'),
              ariaLabel: t('chartActivity'),
            }}
          />
        );
      }
      case 'wonlost': {
        const { wonLost } = data as WidgetDataMap['wonlost'];
        return (
          <WonLostChart
            data={wonLost}
            locale={locale}
            labels={{
              won: tCrm('reports.wonDeals'),
              lost: tCrm('reports.lostDeals'),
              ariaLabel: t('chartWonLost'),
            }}
          />
        );
      }
      case 'source': {
        const { sourcePerformance } = data as WidgetDataMap['source'];
        if (sourcePerformance.length === 0) return empty;
        const max = Math.max(...sourcePerformance.map((s) => s.deals), 1);
        return (
          <div className="breakdown">
            {sourcePerformance.map((s) => (
              <div className="breakdown-row" key={s.source}>
                <span className="breakdown-name" title={s.source}>
                  {tCrm(`enums.source.${s.source}`)}
                </span>
                <span
                  className="breakdown-track"
                  title={`${formatNumber(s.contacts, locale)} · ${formatMoney(s.amount, locale, baseCurrency)}`}
                >
                  <span
                    className="breakdown-bar"
                    style={{ width: `${Math.max((s.deals / max) * 100, 2)}%` }}
                  />
                </span>
                <span className="breakdown-count mono">{formatNumber(s.deals, locale)}</span>
              </div>
            ))}
          </div>
        );
      }
      case 'owner': {
        const { byOwner } = data as WidgetDataMap['owner'];
        if (byOwner.length === 0) return empty;
        return (
          <table className="table owner-table">
            <thead>
              <tr>
                <th>{tCrm('contacts.form.owner')}</th>
                <th className="th-num">{tCrm('reports.contacts')}</th>
                <th className="th-num">{tCrm('reports.deals')}</th>
                <th className="th-num">{tCrm('reports.kpi.wonAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {byOwner.map((o) => (
                <tr key={o.id}>
                  <td>{o.name ?? o.email}</td>
                  <td className="mono td-num">{formatNumber(o.contacts, locale)}</td>
                  <td className="mono td-num">{formatNumber(o.deals, locale)}</td>
                  <td className="mono td-num">{formatMoney(o.wonAmount, locale, baseCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
      case 'leaderboard': {
        const { leaderboard } = data as WidgetDataMap['leaderboard'];
        if (leaderboard.length === 0) return empty;
        const max = Math.max(...leaderboard.map((l) => l.completed), 1);
        return (
          <div className="breakdown">
            {leaderboard.map((l, i) => (
              <div className="breakdown-row" key={l.id}>
                <span className="breakdown-name" title={l.email}>
                  <span className="mono dash-rank">{i + 1}.</span> {l.name ?? l.email}
                </span>
                <span className="breakdown-track">
                  <span
                    className="breakdown-bar"
                    style={{ width: `${Math.max((l.completed / max) * 100, 2)}%` }}
                  />
                </span>
                <span className="breakdown-count mono">{formatNumber(l.completed, locale)}</span>
              </div>
            ))}
          </div>
        );
      }
      case 'tasks': {
        const { tasks } = data as WidgetDataMap['tasks'];
        if (tasks.length === 0) return empty;
        return (
          <ul className="dash-list">
            {tasks.map((task) => (
              <li className="dash-list-row" key={task.id}>
                <span className="dash-list-main" title={task.subject}>
                  {task.subject || tCrm('enums.activityType.task')}
                </span>
                <span className="dash-list-meta mono">
                  {task.due_at ? formatDate(task.due_at, locale) : '—'}
                  {task.contact_name || task.company_name || task.deal_name
                    ? ` · ${task.contact_name ?? task.company_name ?? task.deal_name}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        );
      }
      case 'custom_report': {
        const { report } = data as WidgetDataMap['custom_report'];
        if (!report) return <p className="muted dash-loading">{t('reportMissing')}</p>;
        return (
          <div className="dash-report" data-no-drag>
            <ReportChart result={report.result} viz={report.config.viz} locale={locale} baseCurrency={baseCurrency} compact />
            <p className="dash-report-open">
              <Link href={`/app/crm/reports/custom/${report.id}`}>{t('openReport')}</Link>
            </p>
          </div>
        );
      }
      case 'recent_activity': {
        const { activities } = data as WidgetDataMap['recent_activity'];
        if (activities.length === 0) return empty;
        return (
          <ul className="dash-list">
            {activities.map((a) => (
              <li className="dash-list-row" key={a.id}>
                <span className="dash-list-main" title={a.subject}>
                  <span className="badge">{tCrm(`enums.activityType.${a.type}`)}</span> {a.subject}
                </span>
                <span className="dash-list-meta mono">{formatDate(a.created_at, locale)}</span>
              </li>
            ))}
          </ul>
        );
      }
    }
  }

  // ---------- Render ----------

  return (
    <div className="dash">
      {error && <p className="form-error">{error}</p>}
      {missingRates.length > 0 && (
        <p className="muted currency-note">{tc('currency.missing', { list: missingRates.join(', ') })}</p>
      )}

      <div className="dash-tabs">
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`dash-tab${b.id === activeId ? ' active' : ''}`}
            onClick={() => setActiveId(b.id)}
          >
            {b.name}
          </button>
        ))}
        {creating ? (
          <input
            className="input dash-tab-input"
            autoFocus
            value={newName}
            placeholder={t('namePh')}
            maxLength={200}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitCreate();
              if (e.key === 'Escape') {
                setCreating(false);
                setNewName('');
              }
            }}
            onBlur={() => void submitCreate()}
          />
        ) : (
          <button
            type="button"
            className="dash-tab dash-tab-new"
            onClick={() => setCreating(true)}
          >
            + {t('newDashboard')}
          </button>
        )}
      </div>

      {active ? (
        <>
          <div className="dash-toolbar">
            <input
              className="dash-name-input"
              value={renameValue}
              maxLength={200}
              aria-label={t('renameDashboard')}
              title={t('renameDashboard')}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenameValue(active.name);
              }}
              onBlur={() => void submitRename()}
            />
            <div className="dash-toolbar-actions">
              <div className="dash-add-wrap" ref={addMenuRef}>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setAddMenuOpen((v) => !v)}
                  aria-expanded={addMenuOpen}
                >
                  {t('addWidget')}
                </button>
                {addMenuOpen && (
                  <div className="dash-add-menu" role="menu">
                    {DASHBOARD_MENU_TYPES.map((type) => (
                      <button key={type} type="button" onClick={() => void addNewWidget(type)}>
                        {t(`widgets.${type}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setConfirmingDelete(true)}
              >
                {t('deleteDashboard')}
              </button>
            </div>
          </div>

          {active.widgets.length === 0 ? (
            <div className="panel dash-empty">
              <p className="dash-empty-title">{t('emptyTitle')}</p>
              <p className="muted">{t('emptyDesc')}</p>
            </div>
          ) : (
            <div className="dash-grid" ref={gridRef}>
              <div className="dash-drop-preview" ref={previewRef} aria-hidden="true" />
              {active.widgets.map((w) => {
                const cfg = parseConfig(w.config);
                return (
                  <section
                    className="dash-widget"
                    key={w.id}
                    style={{
                      gridColumn: `${w.x + 1} / span ${w.w}`,
                      gridRow: `${w.y + 1} / span ${w.h}`,
                    }}
                  >
                    <header
                      className="dash-widget-head"
                      onPointerDown={(e) => handleGripDown(e, w, 'move')}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerCancel}
                    >
                      <span className="dash-widget-grip" aria-hidden="true">
                        ⠿
                      </span>
                      <span className="dash-widget-title" title={widgetTitle(w)}>
                        {widgetTitle(w)}
                      </span>
                      <span className="dash-widget-actions">
                        {w.type === 'kpi' && (
                          <select
                            className="dash-widget-select"
                            data-no-drag
                            value={cfg.metric ?? 'newContacts'}
                            aria-label={tCrm('reports.title')}
                            onChange={(e) =>
                              void changeConfig(w, { ...cfg, metric: e.target.value as KpiMetric })
                            }
                          >
                            {KPI_METRICS.map((m) => (
                              <option key={m} value={m}>
                                {tCrm(`reports.kpi.${m}`)}
                              </option>
                            ))}
                          </select>
                        )}
                        {(w.type === 'funnel' || w.type === 'forecast') &&
                          pipelines.length > 1 && (
                            <select
                              className="dash-widget-select"
                              data-no-drag
                              value={cfg.pipelineId ?? defaultPipelineId ?? ''}
                              aria-label={tCrm('reports.pipeline')}
                              onChange={(e) =>
                                void changeConfig(w, {
                                  ...cfg,
                                  pipelineId: e.target.value || null,
                                })
                              }
                            >
                              {pipelines.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          )}
                        <button
                          type="button"
                          className="dash-widget-x"
                          data-no-drag
                          aria-label={tCrm('common.delete')}
                          onClick={() => void removeWidget(w)}
                        >
                          ×
                        </button>
                      </span>
                    </header>
                    <div className="dash-widget-body">{renderBody(w)}</div>
                    <span
                      className="dash-resize"
                      data-no-drag
                      aria-hidden="true"
                      onPointerDown={(e) => handleGripDown(e, w, 'resize')}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerCancel}
                    />
                  </section>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="panel dash-empty">
          <p className="dash-empty-title">{t('noDashboardsTitle')}</p>
          <p className="muted">{t('noDashboardsDesc')}</p>
        </div>
      )}

      {confirmingDelete && active && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t('confirmDeleteTitle')}
        >
          <div className="modal-card">
            <h2 className="modal-title">{t('confirmDeleteTitle')}</h2>
            <p className="muted">
              {t('confirmDelete', { name: active.name, count: active.widgets.length })}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-solid btn-small"
                onClick={() => void confirmDeleteDashboard()}
              >
                {tCrm('common.delete')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setConfirmingDelete(false)}
              >
                {tCrm('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
