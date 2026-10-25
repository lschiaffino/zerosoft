'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ForecastSubmission, ForecastView as ForecastData } from '@/lib/crm-forecast';

interface Props {
  initial: ForecastData;
  pipelines: Array<{ id: string; name: string }>;
  me: string;
  isAdmin: boolean;
  locale: string;
  baseCurrency: string;
}

const CATEGORIES = ['pipeline', 'best_case', 'commit', 'omit'] as const;

/** Categoría por defecto según la probabilidad (misma regla que lib/crm-forecast.ts). */
function autoCategory(probability: number): string {
  if (probability >= 70) return 'commit';
  if (probability >= 40) return 'best_case';
  return 'pipeline';
}

export default function ForecastView({ initial, pipelines, me, isAdmin, locale, baseCurrency }: Props) {
  const t = useTranslations('crm');
  const tf = (k: string, v?: Record<string, string | number>) => t(`forecast.${k}`, v);
  /** 2026-10 → "October 2026" / "octubre de 2026"; 2026-Q4 → "Q4 2026". La clave sigue siendo la de la API. */
  const periodName = (label: string) => {
    const q = /^(\d{4})-Q([1-4])$/.exec(label);
    if (q) return tf('quarterName', { n: Number(q[2]), year: q[1] });
    const m = /^(\d{4})-(\d{2})$/.exec(label);
    if (!m) return label;
    const s = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)),
    );
    return s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  };
  const [period, setPeriod] = useState<'month' | 'quarter'>(initial.period);
  const [offset, setOffset] = useState(0);
  const [team, setTeam] = useState('');
  const [pipeline, setPipeline] = useState('');
  const [data, setData] = useState<ForecastData>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [person, setPerson] = useState('');
  const [submitFor, setSubmitFor] = useState<{ personId: string; name: string; amount: string; note: string } | null>(null);
  const [history, setHistory] = useState<{ personId: string; name: string; rows: ForecastSubmission[] | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const first = useRef(true);

  const money = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: baseCurrency, maximumFractionDigits: 0 }).format(n);
  // Tarjetas: compacto ($120K) para que entre en el ancho de la tarjeta; el monto exacto va en el title.
  const moneyShort = (n: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: baseCurrency, notation: 'compact', maximumFractionDigits: 1 }).format(n);
  // Close date: día del calendario en el formato del idioma.
  const day = (iso: string | null | undefined) =>
    iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '';

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    const qs = new URLSearchParams({ period, offset: String(offset) });
    if (team) qs.set('team', team);
    if (pipeline) qs.set('pipeline', pipeline);
    fetch(`/api/crm/forecast?${qs}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('bad');
        setData((await res.json()) as ForecastData);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(true);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [period, offset, team, pipeline, reloadKey]);

  const canSubmit = (personId: string) => isAdmin || personId === me;

  async function submit() {
    if (!submitFor) return;
    const amount = Number(submitFor.amount);
    if (!Number.isFinite(amount) || amount < 0) return;
    const res = await fetch('/api/crm/forecast/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personId: submitFor.personId, period: data.period, periodLabel: data.periodLabel, amount, note: submitFor.note }),
    });
    if (res.ok) {
      setSubmitFor(null);
      setReloadKey((k) => k + 1);
      if (history?.personId === submitFor.personId) void openHistory(submitFor.personId, submitFor.name);
    } else setError(true);
  }

  async function openHistory(personId: string, name: string) {
    setHistory({ personId, name, rows: null });
    const qs = new URLSearchParams({ personId, period: data.period, label: data.periodLabel });
    const res = await fetch(`/api/crm/forecast/submissions?${qs}`);
    const body = res.ok ? ((await res.json()) as { rows: ForecastSubmission[] }) : { rows: [] };
    setHistory({ personId, name, rows: body.rows });
  }

  async function setCategory(dealId: string, category: string) {
    setData((d) => ({ ...d, deals: d.deals.map((x) => (x.id === dealId ? { ...x, forecast_category: category } : x)) }));
    const res = await fetch(`/api/crm/forecast/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category }),
    });
    if (!res.ok) setError(true);
    setReloadKey((k) => k + 1);
  }

  const total = data.total;
  const names = new Map(data.rows.map((r) => [r.personId, r.name]));
  const deals = person ? data.deals.filter((d) => d.owner_id === person) : data.deals;
  const pctOf = (n: number, goal: number | null) => (goal && goal > 0 ? Math.min(100, Math.round((n / goal) * 100)) : 0);

  return (
    <div className="fc">
      <div className="fc-controls">
        <div className="report-tabs" role="group" aria-label={tf('periodLabel')}>
          {(['month', 'quarter'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`report-tab${p === period ? ' active' : ''}`}
              aria-pressed={p === period}
              onClick={() => {
                setPeriod(p);
                setOffset(0);
              }}
            >
              {tf(`period.${p}`)}
            </button>
          ))}
        </div>
        <div className="fc-period-nav">
          <button type="button" className="btn btn-small btn-ghost" aria-label={tf('prev')} onClick={() => setOffset((o) => o - 1)}>
            ←
          </button>
          <span className="fc-period-label" data-testid="fc-period">
            {periodName(data.periodLabel)}
          </span>
          <button type="button" className="btn btn-small btn-ghost" aria-label={tf('next')} onClick={() => setOffset((o) => o + 1)}>
            →
          </button>
          {offset !== 0 && (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setOffset(0)}>
              {tf('current')}
            </button>
          )}
        </div>
        {data.teams.length > 0 && (
          <label className="report-filter">
            <span>{tf('team')}</span>
            <select className="filter-select" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">{tf('allTeams')}</option>
              {data.teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {pipelines.length > 1 && (
          <label className="report-filter">
            <span>{tf('pipeline')}</span>
            <select className="filter-select" value={pipeline} onChange={(e) => setPipeline(e.target.value)}>
              <option value="">{tf('allPipelines')}</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {loading && <span className="muted rb-status">{t('dashboards.loading')}</span>}
      </div>
      {error && (
        <p className="rb-error" role="alert">
          {tf('error')}
        </p>
      )}

      <div className="fc-kpis" data-testid="fc-kpis">
        {[
          ['goal', total.goal],
          ['closedWon', total.closedWon],
          ['commit', total.commit],
          ['bestCase', total.bestCase],
          ['pipeline', total.pipeline],
          ['weighted', total.weighted],
          ['submitted', total.submitted],
        ].map(([k, v]) => (
          <div key={k as string} className="panel stat-card">
            <span className={v === null ? 'stat-num stat-num-small' : 'stat-num'} title={v === null ? undefined : money(v as number)}>
              {v === null ? tf('noGoal') : moneyShort(v as number)}
            </span>
            <span className="stat-label">{tf(`cols.${k}`)}</span>
          </div>
        ))}
      </div>

      <section className="panel fc-section">
        <p className="section-label">{tf('byPerson')}</p>
        {data.rows.length === 0 ? (
          <p className="muted breakdown-empty">{tf('emptyPeople')}</p>
        ) : (
          <div className="rb-scroll">
            <table className="table fc-table" data-testid="fc-table">
              <thead>
                <tr>
                  <th>{tf('cols.person')}</th>
                  <th className="num">{tf('cols.goal')}</th>
                  <th className="num">{tf('cols.closedWon')}</th>
                  <th className="num">{tf('cols.commit')}</th>
                  <th className="num">{tf('cols.bestCase')}</th>
                  <th className="num">{tf('cols.pipeline')}</th>
                  <th className="num">{tf('cols.weighted')}</th>
                  <th className="num">{tf('cols.submission')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.personId}>
                    <td>
                      <button type="button" className="btn btn-small btn-ghost" aria-pressed={person === r.personId} onClick={() => setPerson(person === r.personId ? '' : r.personId)}>
                        {r.name}
                      </button>
                    </td>
                    <td className="num">
                      {r.goal === null ? <span className="muted">{tf('noGoal')}</span> : money(r.goal)}
                      {r.goal !== null && (
                        <span className="fc-progress" title={tf('attainment', { pct: r.attainment ?? 0 })}>
                          <span style={{ width: `${pctOf(r.closedWon, r.goal)}%` }} />
                        </span>
                      )}
                    </td>
                    <td className="num">{money(r.closedWon)}</td>
                    <td className="num">{money(r.commit)}</td>
                    <td className="num">{money(r.bestCase)}</td>
                    <td className="num">{money(r.pipeline)}</td>
                    <td className="num">{money(r.weighted)}</td>
                    <td className="num">
                      <div className="fc-submit">
                        {r.submission ? (
                          <button type="button" className="btn btn-small btn-ghost" onClick={() => void openHistory(r.personId, r.name)} title={tf('history')}>
                            {money(r.submission.amount)}
                          </button>
                        ) : (
                          <span className="muted">{tf('notSubmitted')}</span>
                        )}
                        {canSubmit(r.personId) && (
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => setSubmitFor({ personId: r.personId, name: r.name, amount: String(r.submission?.amount ?? r.mostLikely), note: '' })}
                          >
                            {r.submission ? tf('update') : tf('submit')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{tf('total')}</td>
                  <td className="num">{total.goal === null ? '' : money(total.goal)}</td>
                  <td className="num">{money(total.closedWon)}</td>
                  <td className="num">{money(total.commit)}</td>
                  <td className="num">{money(total.bestCase)}</td>
                  <td className="num">{money(total.pipeline)}</td>
                  <td className="num">{money(total.weighted)}</td>
                  <td className="num">{money(total.submitted)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="muted fc-help">{tf('help')}</p>
        {history && (
          <div className="panel fc-history" data-testid="fc-history">
            <div className="rb-result-head">
              <p className="section-label">{tf('historyTitle', { name: history.name, period: periodName(data.periodLabel) })}</p>
              <button type="button" className="rb-icon-btn" aria-label={t('common.close')} onClick={() => setHistory(null)}>
                ×
              </button>
            </div>
            {history.rows === null ? (
              <p className="muted">{t('dashboards.loading')}</p>
            ) : history.rows.length === 0 ? (
              <p className="muted">{tf('historyEmpty')}</p>
            ) : (
              <ul>
                {history.rows.map((h) => (
                  <li key={h.id}>
                    <span className="mono">{money(h.amount)}</span>
                    {' · '}
                    <span className="muted">
                      {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(`${h.created_at.replace(' ', 'T')}Z`))}
                      {h.submitted_by ? ` · ${h.submitted_by}` : ''}
                    </span>
                    {h.note && <div>{h.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="panel fc-section">
        <div className="rb-result-head">
          <p className="section-label">{person ? tf('dealsOf', { name: names.get(person) ?? '' }) : tf('deals')}</p>
          {data.undated > 0 && <span className="muted rb-note">{tf('undated', { count: data.undated })}</span>}
        </div>
        {deals.length === 0 ? (
          <p className="muted breakdown-empty">{tf('dealsEmpty')}</p>
        ) : (
          <div className="rb-scroll">
            <table className="table fc-table" data-testid="fc-deals">
              <thead>
                <tr>
                  <th>{tf('cols.deal')}</th>
                  <th>{tf('cols.person')}</th>
                  <th>{tf('cols.stage')}</th>
                  <th>{tf('cols.closeDate')}</th>
                  <th className="num">{tf('cols.amount')}</th>
                  <th>{tf('cols.category')}</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/app/crm/deals/${d.id}`}>{d.name || d.id}</Link>
                    </td>
                    <td>{names.get(d.owner_id) ?? ''}</td>
                    <td>
                      {d.stage_name} <span className="muted mono">{d.probability}%</span>
                    </td>
                    <td>{day(d.is_won ? d.closed_at : d.close_date)}</td>
                    <td className="num">{money(d.amount)}</td>
                    <td>
                      {d.is_won ? (
                        tf('category.closed_won')
                      ) : (
                        <select
                          className="filter-select fc-cat-select"
                          aria-label={tf('cols.category')}
                          value={d.forecast_category}
                          onChange={(e) => void setCategory(d.id, e.target.value)}
                        >
                          <option value="">{tf('category.auto', { category: tf(`category.${autoCategory(d.probability)}`) })}</option>
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {tf(`category.${c}`)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {submitFor && (
        <div className="fc-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSubmitFor(null)}>
          <form
            className="fc-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fc-submit-title"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            onKeyDown={(e) => e.key === 'Escape' && setSubmitFor(null)}
          >
            <h2 id="fc-submit-title">{tf('submitTitle', { name: submitFor.name, period: periodName(data.periodLabel) })}</h2>
            <label>
              {tf('cols.amount')}
              <input
                className="input"
                type="number"
                min={0}
                step="any"
                autoFocus
                value={submitFor.amount}
                onChange={(e) => setSubmitFor({ ...submitFor, amount: e.target.value })}
              />
            </label>
            <label>
              {tf('note')}
              <textarea className="input" rows={3} maxLength={500} value={submitFor.note} onChange={(e) => setSubmitFor({ ...submitFor, note: e.target.value })} />
            </label>
            <p className="muted rb-note">{tf('submitHint', { mostLikely: money(data.rows.find((r) => r.personId === submitFor.personId)?.mostLikely ?? 0) })}</p>
            <div className="fc-dialog-actions">
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setSubmitFor(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-small btn-solid">
                {tf('submit')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
