'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { PlanSummary } from '@/lib/track-plans';
import type { InitiativeSummary } from '@/lib/track-initiatives';
import { api, fmtDay, HealthDot, LoadingRows, PlanStatusIcon } from './shared';
import { projectPath } from '@/lib/track-routes';

type Zoom = 'week' | 'month' | 'quarter';
type Mode = 'plans' | 'initiatives';
type GroupBy = 'none' | 'initiative' | 'status' | 'lead';

const DAY_MS = 86_400_000;
/** Ancho de un día según el zoom (como semanas / meses / trimestres de Linear). */
const DAY_PX: Record<Zoom, number> = { week: 28, month: 8, quarter: 3 };
const DRAG_THRESHOLD = 5;

function dayOf(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const today0 = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

interface Row {
  id: string;
  name: string;
  href: string;
  icon: string | null;
  status: string;
  health: PlanSummary['health'];
  start: Date | null;
  end: Date | null;
  percent: number;
  milestones: Array<{ id: string; name: string; date: Date | null; percent: number }>;
  draggable: boolean;
}

interface Drag {
  pointerId: number;
  id: string;
  mode: 'move' | 'start' | 'end';
  x0: number;
  start: Date;
  end: Date;
  delta: number;
  moved: boolean;
  /** Fechas en vivo (las mismas que el preview). */
  cur: { start: Date; end: Date } | null;
}

/**
 * Roadmap: timeline de plans (o de initiatives) con barras de inicio a fecha
 * objetivo que se arrastran o estiran para cambiar fechas, milestones como
 * rombos, línea de hoy y zoom por semanas, meses o trimestres.
 */
export default function Roadmap() {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const zoom = (['week', 'month', 'quarter'].includes(sp.get('zoom') ?? '') ? sp.get('zoom') : 'month') as Zoom;
  const mode = (sp.get('mode') === 'initiatives' ? 'initiatives' : 'plans') as Mode;
  const groupBy = (['initiative', 'status', 'lead'].includes(sp.get('group') ?? '') ? sp.get('group') : 'none') as GroupBy;
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [initiatives, setInitiatives] = useState<InitiativeSummary[]>([]);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<{ id: string; start: Date; end: Date } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppress = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [p, i] = await Promise.all([api<{ rows: PlanSummary[] }>('/api/track/plans'), api<{ rows: InitiativeSummary[] }>('/api/track/initiatives')]);
    setFailed(!p.ok);
    setPlans(p.ok ? p.data.rows : []);
    setInitiatives(i.ok ? i.data.rows : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setParam = (k: string, v: string, def: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v === def) q.delete(k);
    else q.set(k, v);
    router.replace(`/app/track/roadmap${q.toString() ? `?${q}` : ''}`);
  };

  const rows: Row[] = useMemo(() => {
    if (mode === 'initiatives') {
      return initiatives.map((i) => ({
        id: i.id,
        name: i.name,
        href: `/app/track/initiatives/${i.id}`,
        icon: i.icon,
        status: i.status,
        health: i.health,
        start: dayOf(i.start_date),
        end: dayOf(i.end_date),
        percent: i.percent,
        milestones: [],
        draggable: false,
      }));
    }
    return (plans ?? []).map((p) => {
      const end = dayOf(p.target_date);
      const start = dayOf(p.start_date) ?? (end ? (dayOf(p.created_at) ?? end) : null);
      return {
        id: p.id,
        name: p.name,
        href: projectPath(p.id),
        icon: p.icon,
        status: p.status,
        health: p.health,
        start: start && end && start > end ? end : start,
        end,
        percent: p.progress.percent,
        milestones: p.milestones.map((m) => ({ id: m.id, name: m.name, date: dayOf(m.target_date), percent: m.percent })),
        draggable: true,
      };
    });
  }, [mode, plans, initiatives]);

  const scheduled = rows.filter((r) => r.start && r.end);
  const unscheduled = rows.filter((r) => !(r.start && r.end));

  const groups = useMemo(() => {
    if (mode === 'initiatives' || groupBy === 'none') return [{ key: 'all', label: '', rows: scheduled }];
    const planById = new Map((plans ?? []).map((p) => [p.id, p]));
    const keyOf = (r: Row): Array<{ key: string; label: string }> => {
      const p = planById.get(r.id);
      if (!p) return [{ key: 'none', label: '' }];
      if (groupBy === 'status') return [{ key: p.status, label: t(`status.${p.status}`) }];
      if (groupBy === 'lead') return [{ key: p.lead_id ?? 'none', label: p.lead_name || p.lead_email || t('common.noLead') }];
      return p.initiatives.length ? p.initiatives.map((i) => ({ key: i.id, label: i.name })) : [{ key: 'none', label: t('roadmap.noInitiative') }];
    };
    const map = new Map<string, { key: string; label: string; rows: Row[] }>();
    for (const r of scheduled) {
      for (const k of keyOf(r)) {
        const g = map.get(k.key) ?? { key: k.key, label: k.label, rows: [] };
        g.rows.push(r);
        map.set(k.key, g);
      }
    }
    return [...map.values()].sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label)));
  }, [mode, groupBy, scheduled, plans, t]);

  // Ventana: cubre todas las barras y hoy, con margen según el zoom.
  const pad = zoom === 'week' ? 14 : zoom === 'month' ? 45 : 120;
  const range = useMemo(() => {
    const now = today0();
    let min = addDays(now, -pad).getTime();
    let max = addDays(now, pad).getTime();
    for (const r of scheduled) {
      if (r.start && r.start.getTime() - pad * DAY_MS < min) min = r.start.getTime() - pad * DAY_MS;
      if (r.end && r.end.getTime() + pad * DAY_MS > max) max = r.end.getTime() + pad * DAY_MS;
    }
    const start = new Date(min);
    return { start: new Date(start.getFullYear(), start.getMonth(), 1), end: new Date(max) };
  }, [scheduled, pad]);
  const dayPx = DAY_PX[zoom];
  const totalDays = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS) + 1);
  const width = totalDays * dayPx;
  const xOf = (d: Date) => Math.round((d.getTime() - range.start.getTime()) / DAY_MS) * dayPx;

  // Cabecera: meses (o trimestres) y, en zoom semana, los lunes.
  const ticks = useMemo(() => {
    const out: Array<{ key: string; x: number; w: number; label: string }> = [];
    const step = zoom === 'quarter' ? 3 : 1;
    let d = new Date(range.start.getFullYear(), Math.floor(range.start.getMonth() / step) * step, 1);
    while (d <= range.end) {
      const next = new Date(d.getFullYear(), d.getMonth() + step, 1);
      const label =
        zoom === 'quarter'
          ? `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
          : d.toLocaleDateString(locale, { month: 'short', year: d.getMonth() === 0 || out.length === 0 ? 'numeric' : undefined });
      const x = Math.max(0, xOf(d));
      out.push({ key: d.toISOString(), x, w: xOf(next) - x, label });
      d = next;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, zoom, locale, dayPx]);
  const weeks = useMemo(() => {
    if (zoom !== 'week') return [];
    const out: Array<{ key: string; x: number; label: string }> = [];
    const first = range.start;
    const dow = (first.getDay() + 6) % 7;
    for (let d = addDays(first, dow === 0 ? 0 : 7 - dow); d <= range.end; d = addDays(d, 7)) out.push({ key: d.toISOString(), x: xOf(d), label: String(d.getDate()) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, zoom, dayPx]);

  const todayX = xOf(today0());
  const scrollToToday = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, todayX - el.clientWidth / 3);
  }, [todayX]);
  useEffect(() => {
    scrollToToday();
  }, [scrollToToday, plans, zoom]);

  // ---------- Drag de barras ----------
  const onDown = (e: RPointerEvent<HTMLAnchorElement>, r: Row) => {
    if (!r.draggable || !r.start || !r.end) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    const target = e.target as HTMLElement;
    const mode = target.closest('.tp-bar-start') ? 'start' : target.closest('.tp-bar-end') ? 'end' : 'move';
    dragRef.current = { pointerId: e.pointerId, id: r.id, mode, x0: e.clientX, start: r.start, end: r.end, delta: 0, moved: false, cur: null };
    setError(null);
  };
  const onMove = (e: RPointerEvent<HTMLAnchorElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < DRAG_THRESHOLD) return;
    d.moved = true;
    const delta = Math.round((e.clientX - d.x0) / dayPx);
    if (delta === d.delta) return;
    d.delta = delta;
    let s = d.start;
    let en = d.end;
    if (d.mode === 'move') {
      s = addDays(d.start, delta);
      en = addDays(d.end, delta);
    } else if (d.mode === 'start') {
      s = addDays(d.start, delta);
      if (s > en) s = en;
    } else {
      en = addDays(d.end, delta);
      if (en < s) en = s;
    }
    d.cur = { start: s, end: en };
    setPreview({ id: d.id, start: s, end: en });
  };
  const onUp = async (e: RPointerEvent<HTMLAnchorElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return;
    suppress.current = true;
    const p = d.cur;
    if (!p) return setPreview(null);
    const res = await api<PlanSummary>(`/api/track/plans/${d.id}`, 'PATCH', { startDate: ymd(p.start), targetDate: ymd(p.end) });
    setPreview(null);
    if (!res.ok) return setError(t('roadmap.updateError'));
    setPlans((prev) => (prev ? prev.map((x) => (x.id === d.id ? res.data : x)) : prev));
  };

  /** Teclado: con foco en una barra, ←/→ mueven un día; con Shift, cambian solo la fecha objetivo. */
  const onKey = async (e: React.KeyboardEvent<HTMLAnchorElement>, r: Row) => {
    if (!r.draggable || !r.start || !r.end || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const n = e.key === 'ArrowLeft' ? -1 : 1;
    const start = e.shiftKey ? r.start : addDays(r.start, n);
    const end = addDays(r.end, n) < start ? start : addDays(r.end, n);
    const res = await api<PlanSummary>(`/api/track/plans/${r.id}`, 'PATCH', { startDate: ymd(start), targetDate: ymd(end) });
    if (!res.ok) return setError(t('roadmap.updateError'));
    setPlans((prev) => (prev ? prev.map((x) => (x.id === r.id ? res.data : x)) : prev));
  };

  const empty = mode === 'plans' ? (plans?.length ?? 0) === 0 : initiatives.length === 0;

  return (
    <div className="tp-roadmap" data-testid="tp-roadmap">
      <div className="tp-toolbar" role="toolbar" aria-label={t('roadmap.title')}>
        <div className="btn-group" role="group" aria-label={t('roadmap.mode')}>
          {(['plans', 'initiatives'] as const).map((m) => (
            <button key={m} type="button" className="btn btn-sm" aria-pressed={mode === m} onClick={() => setParam('mode', m, 'plans')}>
              {t(m === 'plans' ? 'roadmap.modePlans' : 'roadmap.modeInitiatives')}
            </button>
          ))}
        </div>
        <div className="btn-group" role="group" aria-label={t('roadmap.zoom')}>
          {(['week', 'month', 'quarter'] as const).map((z) => (
            <button key={z} type="button" className="btn btn-sm" aria-pressed={zoom === z} onClick={() => setParam('zoom', z, 'month')} data-testid={`tp-zoom-${z}`}>
              {t(`roadmap.${z}`)}
            </button>
          ))}
        </div>
        {mode === 'plans' && (
          <>
            <label className="sr-only" htmlFor="tp-rm-group">
              {t('roadmap.groupBy')}
            </label>
            <select id="tp-rm-group" className="select" value={groupBy} onChange={(e) => setParam('group', e.target.value, 'none')}>
              <option value="none">{t('roadmap.groupNone')}</option>
              <option value="initiative">{t('roadmap.groupInitiative')}</option>
              <option value="status">{t('roadmap.groupStatus')}</option>
              <option value="lead">{t('roadmap.groupLead')}</option>
            </select>
          </>
        )}
        <button type="button" className="btn btn-sm tp-toolbar-end" onClick={scrollToToday}>
          {t('common.today')}
        </button>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      {plans === null ? (
        <LoadingRows rows={5} />
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
      ) : empty ? (
        <EmptyState
          title={t('roadmap.emptyTitle')}
          body={t('roadmap.emptyBody')}
          action={mode === 'plans' ? { label: t('plans.new'), href: '/app/track/projects?new=1' } : { label: t('initiatives.new'), href: '/app/track/initiatives?new=1' }}
        />
      ) : (
        <>
          <p className="ui-help">{t('roadmap.dragHint')}</p>
          <div className="tp-tl">
            <div className="tp-tl-side">
              <div className="tp-tl-side-head" />
              {groups.map((g) => (
                <div key={g.key}>
                  {g.label && <div className="tp-tl-group">{g.label}</div>}
                  {g.rows.map((r) => (
                    <div key={`${g.key}-${r.id}`} className="tp-tl-side-row">
                      <span className="tp-row-icon" aria-hidden="true">
                        {r.icon || <PlanStatusIcon status={r.status} />}
                      </span>
                      <Link href={r.href} className="tp-tl-name">
                        {r.name}
                      </Link>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="tp-tl-scroll" ref={scrollRef}>
              <div className="tp-tl-canvas" style={{ width }}>
                <div className="tp-tl-head">
                  {ticks.map((m) => (
                    <span key={m.key} className="tp-tl-tick" style={{ left: m.x, width: m.w }}>
                      {m.label}
                    </span>
                  ))}
                  {weeks.map((w) => (
                    <span key={w.key} className="tp-tl-week" style={{ left: w.x }}>
                      {w.label}
                    </span>
                  ))}
                </div>
                {ticks.map((m) => (
                  <div key={`g-${m.key}`} className="tp-tl-grid" style={{ left: m.x }} aria-hidden="true" />
                ))}
                <div className="tp-tl-today" style={{ left: todayX }} aria-hidden="true">
                  <span>{t('common.today')}</span>
                </div>
                {groups.map((g) => (
                  <div key={g.key}>
                    {g.label && <div className="tp-tl-group tp-tl-group-canvas" aria-hidden="true" />}
                    {g.rows.map((r) => {
                      const p = preview && preview.id === r.id ? preview : null;
                      const s = p ? p.start : (r.start as Date);
                      const en = p ? p.end : (r.end as Date);
                      const left = xOf(s);
                      const w = Math.max(dayPx, xOf(addDays(en, 1)) - left);
                      return (
                        <div key={`${g.key}-${r.id}`} className="tp-tl-row">
                          <Link
                            href={r.href}
                            className={`tp-bar tp-bar-${r.status}${p ? ' dragging' : ''}${r.draggable ? ' tp-bar-drag' : ''}`}
                            style={{ left, width: w }}
                            draggable={false}
                            title={`${r.name} · ${fmtDay(ymd(s), locale, true)} → ${fmtDay(ymd(en), locale, true)} · ${r.percent}%`}
                            aria-label={`${r.name}, ${fmtDay(ymd(s), locale, true)} → ${fmtDay(ymd(en), locale, true)}`}
                            onPointerDown={(e) => onDown(e, r)}
                            onPointerMove={onMove}
                            onPointerUp={(e) => void onUp(e)}
                            onPointerCancel={() => {
                              dragRef.current = null;
                              setPreview(null);
                            }}
                            onClick={(e) => {
                              if (suppress.current) {
                                suppress.current = false;
                                e.preventDefault();
                              }
                            }}
                            onKeyDown={(e) => void onKey(e, r)}
                            data-testid="tp-bar"
                          >
                            <span className="tp-bar-fill" style={{ width: `${r.percent}%` }} aria-hidden="true" />
                            <span className="tp-bar-label">{r.name}</span>
                            <HealthDot health={r.health} label="" />
                            {r.draggable && (
                              <>
                                <span className="tp-bar-handle tp-bar-start" aria-hidden="true" />
                                <span className="tp-bar-handle tp-bar-end" aria-hidden="true" />
                              </>
                            )}
                          </Link>
                          {r.milestones
                            .filter((m) => m.date)
                            .map((m) => (
                              <span
                                key={m.id}
                                className={`tp-tl-ms${m.percent >= 100 ? ' done' : ''}`}
                                style={{ left: xOf(m.date as Date) + dayPx / 2 }}
                                title={`${m.name} · ${fmtDay(ymd(m.date as Date), locale, true)} · ${m.percent}%`}
                              />
                            ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {unscheduled.length > 0 && (
            <section className="tp-card" aria-labelledby="tp-unsched">
              <h3 id="tp-unsched" className="tp-card-title">
                {t('roadmap.unscheduled')}
              </h3>
              <ul className="tp-rows" role="list">
                {unscheduled.map((r) => (
                  <li key={r.id} className="tp-row">
                    <Link href={r.href} className="tp-row-link">
                      <span className="tp-row-name">{r.name}</span>
                    </Link>
                    <span className="ui-help">{t('roadmap.unscheduledHelp')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
