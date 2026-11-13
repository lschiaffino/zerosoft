import type { CSSProperties, ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { ANALYTICS_PERIODS, delta, formatMoney, share, type Kpi, type PeriodChoice, type RangeInfo } from '@/lib/analytics-kit/period';
import type { ProductKey } from '@/lib/products';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { CountUp, TimeZoneSync } from './charts';

/**
 * Analítica, el kit (piezas de servidor): la página con su período, filtros,
 * aviso del rango y vacío; las tarjetas con número que cuenta, los paneles,
 * las barras, el mapa de calor y las tablas. Reciben los datos ya agregados y
 * los textos; lo único que corre en el navegador es el número que cuenta, el
 * gráfico (charts.tsx) y la zona horaria. Estilos en styles/analytics-kit.css
 * (clases la-*, de los reportes de Lines, donde nació).
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface Fmt {
  /** Textos del producto. */
  t: Translate;
  /** Textos del kit (namespace analyticsKit). */
  k: Translate;
  locale: string;
  num: (v: number) => string;
  /** Minutos a "12 min", "3 h", "2 días". */
  dur: (min: number | null | undefined) => string;
  day: (day: string) => string;
  dateTime: (iso: string) => string;
  /** Moneda de los montos (KpiTile kind="money"). */
  currency: string;
  money: (v: number) => string;
  /** Fracción (0.25) a "25 %". */
  pct: (v: number) => string;
}

/** El formateador de una página: números, duraciones, días y montos en el idioma y la zona de quien mira. */
export function analyticsFmt(opts: { locale: string; tz: string; t: Translate; k: Translate; currency?: string }): Fmt {
  const { locale, tz, t, k } = opts;
  const currency = opts.currency || 'USD';
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dateTimeFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz });
  return {
    t,
    k,
    locale,
    currency,
    num: (v) => number.format(v),
    dur: (min) => {
      if (min == null) return '—';
      if (min < 60) return k('time.minLong', { n: number.format(min) });
      if (min < 1440) return k('time.hoursLong', { n: number.format(Math.round((min / 60) * 10) / 10) });
      return k('time.daysLong', { n: number.format(Math.round((min / 1440) * 10) / 10) });
    },
    day: (d) => dayFmt.format(new Date(`${d}T00:00:00Z`)),
    dateTime: (iso) => {
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? dateTimeFmt.format(new Date(ms)) : '—';
    },
    money: (v) => formatMoney(v, locale, currency),
    pct: (v) => percent.format(Number.isFinite(v) ? v : 0),
  };
}

/** "Del 1 al 30" para el lector de pantalla de un gráfico. */
export const chartAria = (f: Fmt, title: string, range: Pick<RangeInfo, 'from' | 'to'>) => f.k('chartAria', { title, from: range.from, to: range.to });

/** Parte de un total, como porcentaje. */
export const pctOf = (f: Fmt, part: number, total: number) => f.pct(share(part, total));

// ---------- Tarjetas ----------

export function Sparkline({ values, tone }: { values: number[]; tone: 'in' | 'out' }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(28 - (Math.max(0, v) / max) * 26).toFixed(2)}`);
  return (
    <svg className="la-spark" data-tone={tone} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polygon className="la-spark-area" points={`0,30 ${pts.join(' ')} 100,30`} />
      <polyline className="la-spark-line" pathLength={1} points={pts.join(' ')} />
    </svg>
  );
}

export type Better = 'up' | 'down' | 'none';
export type KpiKind = 'number' | 'decimal' | 'duration' | 'money' | 'percent';

export function KpiTile({
  f,
  i,
  label,
  kpi,
  kind = 'number',
  better = 'none',
  spark,
  sparkTone = 'in',
  snapshot = false,
}: {
  f: Fmt;
  /** Posición: escalona la entrada. */
  i: number;
  label: string;
  kpi: Kpi;
  kind?: KpiKind;
  /** Qué dirección es buena: tiñe el cambio. */
  better?: Better;
  spark?: number[];
  sparkTone?: 'in' | 'out';
  /** Una foto de ahora (no del período): lo dice al pie. */
  snapshot?: boolean;
}) {
  const show = (v: number | null | undefined) => (v == null ? '—' : kind === 'duration' ? f.dur(v) : kind === 'money' ? f.money(v) : kind === 'percent' ? f.pct(v) : f.num(v));
  // Una tasa se compara en puntos (de 40 % a 50 % son +10 pts, no +25 %).
  const points = kind === 'percent' && kpi.value != null && kpi.prev != null ? Math.round((kpi.value - kpi.prev) * 100) : null;
  const d = kpi.prev === undefined ? null : kind === 'percent' ? (points == null ? null : points / 100) : delta(kpi.value, kpi.prev);
  const tone = d == null || d === 0 || better === 'none' ? 'flat' : d > 0 === (better === 'up') ? 'good' : 'bad';
  let foot: ReactNode = null;
  if (snapshot) foot = f.k('rightNow');
  else if (kpi.prev === undefined) foot = null;
  else if (d != null) {
    foot = (
      <>
        <span className="la-delta" data-tone={tone}>
          {points != null
            ? f.k('points', { n: new Intl.NumberFormat(f.locale, { signDisplay: 'exceptZero' }).format(points) })
            : new Intl.NumberFormat(f.locale, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(d)}
        </span>
        <span>{f.k('before', { value: show(kpi.prev) })}</span>
      </>
    );
  } else if (kpi.prev != null && kpi.value != null && (kpi.prev !== 0 || kpi.value !== 0)) foot = f.k('before', { value: show(kpi.prev) });
  return (
    <div className="la-kpi" style={{ '--i': i } as CSSProperties} data-kpi={label}>
      <span className="la-kpi-label">{label}</span>
      <strong className="la-kpi-value">
        {kpi.value == null ? (
          '—'
        ) : kind === 'duration' ? (
          f.dur(kpi.value)
        ) : (
          <CountUp
            value={kpi.value}
            locale={f.locale}
            decimals={kind === 'decimal' ? 1 : 0}
            currency={kind === 'money' ? f.currency : undefined}
            percent={kind === 'percent'}
          />
        )}
      </strong>
      <span className="la-kpi-foot">{foot}</span>
      {spark && <Sparkline values={spark} tone={sparkTone} />}
    </div>
  );
}

/** Las tarjetas en filas parejas: hasta 5 en una fila; 6 en 3 + 3; 7 y 8 en 4 por fila. */
export function Kpis({ children }: { children: ReactNode[] }) {
  const n = children.filter(Boolean).length;
  const cols = n <= 5 ? n : n === 6 ? 3 : 4;
  return (
    <div className="la-kpis" style={{ '--cols': cols } as CSSProperties}>
      {children}
    </div>
  );
}

// ---------- Paneles ----------

export function Panel({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="la-panel" aria-label={title}>
      <div className="la-panel-head">
        <h2 className="la-panel-title">{title}</h2>
      </div>
      {children}
      {note && <p className="la-panel-note">{note}</p>}
    </section>
  );
}

/** Dos paneles lado a lado (uno debajo del otro en angosto). */
export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="la-grid">{children}</div>;
}

export interface BarRow {
  key: string;
  label: ReactNode;
  value: string;
  extra?: string;
  sub?: string;
  /** 0..1: el largo de la barra. */
  share: number;
}

export function BarList({ rows, tone, empty }: { rows: BarRow[]; tone?: 'ink'; empty: string }) {
  if (rows.length === 0) return <p className="la-panel-empty">{empty}</p>;
  return (
    <ul className="la-bars" data-tone={tone}>
      {rows.map((r, i) => (
        <li key={r.key}>
          <span className="la-bars-label">{r.label}</span>
          <span className="la-bars-value">
            {r.value}
            {r.extra && <small>{r.extra}</small>}
          </span>
          <span className="la-bars-track" aria-hidden="true">
            <i className="la-bars-fill" style={{ '--w': share(r.share, 1).toFixed(4), '--i': Math.min(i, 12) } as CSSProperties} />
          </span>
          {r.sub && <span className="la-bars-sub">{r.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  /** Columna numérica: alineada a la derecha, en mono. */
  num?: boolean;
  cell: (row: T) => ReactNode;
  className?: (row: T) => string | undefined;
}

/** Una tabla dentro de un panel (con scroll propio si no entra). */
export function DataTable<T>({ rows, columns, rowKey, empty, className = '' }: { rows: T[]; columns: Array<Column<T>>; rowKey: (row: T) => string; empty: string; className?: string }) {
  if (rows.length === 0) return <p className="la-panel-empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className={`table la-table ${className}`.trim()}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key} className={[c.num ? 'num' : '', c.className?.(r) ?? ''].filter(Boolean).join(' ') || undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lunes a domingo en el idioma de quien mira (el 1 de enero de 2024 fue lunes). */
export function weekdays(locale: string, style: 'short' | 'long'): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Día de la semana (0 = lunes) por hora local (0-23). `none` sin datos; `peak` describe la celda más alta. */
export function Heatmap({ f, data, none, peak }: { f: Fmt; data: number[][]; none: string; peak: (p: { day: string; hour: string; n: string }) => string }) {
  const max = Math.max(0, ...data.flat());
  if (max === 0) return <p className="la-panel-empty">{none}</p>;
  const short = weekdays(f.locale, 'short');
  const long = weekdays(f.locale, 'long');
  let top = { d: 0, h: 0, v: -1 };
  data.forEach((row, d) => row.forEach((v, h) => (v > top.v ? (top = { d, h, v }) : null)));
  const peakText = peak({ day: long[top.d], hour: hourLabel(top.h), n: f.num(top.v) });
  return (
    <>
      <div className="la-heat" role="img" aria-label={peakText}>
        {data.map((row, d) => (
          <div key={d} style={{ display: 'contents' }}>
            <span className="la-heat-day">{short[d]}</span>
            <div className="la-heat-row">
              {row.map((v, h) => (
                <span key={h} className="la-heat-cell" style={{ '--v': (v === 0 ? 0 : 0.12 + 0.88 * (v / max)).toFixed(3), '--h': h } as CSSProperties} title={`${long[d]} ${hourLabel(h)} · ${f.num(v)}`} />
              ))}
            </div>
          </div>
        ))}
        <span />
        <div className="la-heat-hours" aria-hidden="true">
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
            <span key={h}>{String(h).padStart(2, '0')}</span>
          ))}
        </div>
      </div>
      <p className="la-heat-scale">
        {f.k('heatLess')}
        {[0, 0.3, 0.55, 0.8, 1].map((v) => (
          <i key={v} style={{ '--v': v } as CSSProperties} aria-hidden="true" />
        ))}
        {f.k('heatMore')}
      </p>
      <p className="la-panel-note">{peakText}</p>
    </>
  );
}

/** Una grilla 7 × 24 vacía. */
export const emptyHeat = (): number[][] => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));

// ---------- Página ----------

/** 7, 30 y 90 días. `hrefFor` arma la URL con ese período (y sin rango propio). */
export function PeriodPicker({ f, period, hrefFor }: { f: Fmt; period: Pick<PeriodChoice, 'days' | 'custom'>; hrefFor: (days: number) => string }) {
  return (
    <nav className="la-periods" aria-label={f.k('period')}>
      {ANALYTICS_PERIODS.map((p) => {
        const on = !period.custom && p === period.days;
        return (
          <Link key={p} href={hrefFor(p)} className={`btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}`} aria-current={on ? 'page' : undefined}>
            {f.k('days', { n: p })}
          </Link>
        );
      })}
    </nav>
  );
}

/** "Del … al …", contra qué se compara, la zona horaria y si el rango se recortó. */
export function RangeNote({ f, range }: { f: Fmt; range: RangeInfo }) {
  return (
    <p className="la-range" role="status">
      <strong>{f.k('showing', { from: range.from, to: range.to })}</strong>
      <span>{f.k('compare', { n: range.days, from: range.prevFrom, to: range.prevTo })}</span>
      <span>{f.k('tz', { tz: range.tz.replace(/_/g, ' ') })}</span>
      {range.clipped && <span>{f.k('clipped')}</span>}
    </p>
  );
}

export interface AnalyticsPageProps {
  f: Fmt;
  title: string;
  description?: string;
  /** Color y glifo del producto. */
  product: ProductKey;
  range: RangeInfo;
  period: PeriodChoice;
  /** URL de la página con ese período de 7, 30 o 90 días (sin rango propio), con el resto de los filtros. */
  periodHref: (days: number) => string;
  /** Ruta del formulario de filtros, con el idioma (/es/app/…). */
  formAction: string;
  /** Campos propios del formulario (selects), después de las fechas. */
  filters?: ReactNode;
  /** Campos ocultos que el formulario conserva (la pestaña, por ejemplo). */
  hidden?: Record<string, string | undefined>;
  /** Hay filtros o rango propio aplicados: muestra "Limpiar" y otro vacío. */
  filtered: boolean;
  clearHref: string;
  exportHref?: string;
  /** Pestañas, entre los filtros y el aviso del rango. */
  tabs?: ReactNode;
  empty: boolean;
  emptyTitle: string;
  emptyBody: string;
  /** Texto del vacío cuando hay filtros (por defecto, el del kit). */
  emptyFilteredBody?: string;
  /** Clave del contenido: cambiarla vuelve a montar (los gráficos se dibujan y los números cuentan de nuevo). */
  contentKey: string;
  foot?: ReactNode;
  children: ReactNode;
}

/**
 * La página de analítica de un producto: encabezado con los períodos (y el
 * CSV), filtros por fecha y propios, pestañas, el aviso del rango y el
 * contenido o el vacío. Los períodos y los filtros son links y un formulario
 * GET: funcionan antes de hidratar y la URL se comparte tal cual.
 */
export function AnalyticsPage(p: AnalyticsPageProps) {
  const { f, range, period } = p;
  const inputDay = (raw: string | undefined, applied: string) => (period.inverted ? raw : period.custom ? applied : '');
  const hidden = { ...p.hidden, days: !period.custom && period.days !== 30 ? String(period.days) : undefined };
  return (
    <div className="ui-page la" data-product={p.product}>
      <TimeZoneSync serverTz={range.tz} />
      <PageHeader
        title={p.title}
        description={p.description}
        actions={
          <div className="la-head-actions">
            <PeriodPicker f={f} period={period} hrefFor={p.periodHref} />
            {p.exportHref && (
              <a className="btn btn-sm btn-ghost" href={p.exportHref} download>
                {f.k('exportCsv')}
              </a>
            )}
          </div>
        }
      />
      <form className="la-filters" method="get" action={p.formAction} aria-label={f.k('filters')}>
        <label className="ui-field">
          <span className="label">{f.k('from')}</span>
          <input
            className="input"
            type="date"
            name="from"
            defaultValue={inputDay(period.rawFrom, range.from)}
            aria-invalid={period.inverted || undefined}
            aria-describedby={period.inverted ? 'la-range-error' : undefined}
          />
        </label>
        <label className="ui-field">
          <span className="label">{f.k('to')}</span>
          <input
            className="input"
            type="date"
            name="to"
            defaultValue={inputDay(period.rawTo, range.to)}
            aria-invalid={period.inverted || undefined}
            aria-describedby={period.inverted ? 'la-range-error' : undefined}
          />
        </label>
        {p.filters}
        {Object.entries(hidden).map(([name, value]) => (value === undefined ? null : <input key={name} type="hidden" name={name} value={value} />))}
        <div className="la-filters-actions">
          <button type="submit" className="btn btn-secondary btn-sm">
            {f.k('apply')}
          </button>
          {p.filtered && (
            <Link href={p.clearHref} className="btn btn-ghost btn-sm">
              {f.k('clear')}
            </Link>
          )}
        </div>
      </form>
      {period.inverted && (
        <p className="ui-error" role="alert" id="la-range-error">
          {f.k('rangeInverted')}
        </p>
      )}
      {p.tabs}
      <RangeNote f={f} range={range} />
      {p.empty ? (
        <div className="la-empty" key={`${p.contentKey}-empty`}>
          <EmptyState
            title={p.filtered ? f.k('emptyFilteredTitle') : p.emptyTitle}
            body={p.filtered ? (p.emptyFilteredBody ?? f.k('emptyFilteredBody')) : p.emptyBody}
            product={p.product}
          />
        </div>
      ) : (
        // La clave hace que el contenido se monte de nuevo: los gráficos se dibujan y los números cuentan al cambiar.
        <div className="la" key={p.contentKey} data-tab={p.contentKey}>
          {p.children}
        </div>
      )}
      {p.foot && <p className="la-foot">{p.foot}</p>}
    </div>
  );
}

/** Query string con los parámetros dados (los undefined se omiten). */
export function queryString(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}
