import type { CSSProperties, ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import {
  delta,
  share,
  type AgentStat,
  type AnalyticsData,
  type BroadcastsData,
  type ConversationsData,
  type DayPoint,
  type GroupsData,
  type Kpi,
  type LabelsData,
  type LineStat,
  type OverviewData,
  type ResponseData,
  type TeamData,
  type TicketsData,
} from '@/lib/groups-analytics-shared';
import { CountUp, TrendChart } from './charts';

/**
 * Lines, reportes: las pestañas del tablero. Componentes de servidor: reciben
 * los datos ya agregados y los textos; lo único que corre en el navegador es
 * el número que cuenta y el gráfico con detalle (charts.tsx).
 */

export interface Fmt {
  t: (key: string, values?: Record<string, string | number>) => string;
  locale: string;
  num: (v: number) => string;
  dur: (min: number | null | undefined) => string;
  day: (day: string) => string;
  dateTime: (iso: string) => string;
}

// ---------- Piezas ----------

function Sparkline({ values, tone }: { values: number[]; tone: 'in' | 'out' }) {
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

type Better = 'up' | 'down' | 'none';

function KpiTile({
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
  i: number;
  label: string;
  kpi: Kpi;
  kind?: 'number' | 'decimal' | 'duration';
  /** Qué dirección es buena: tiñe el cambio. */
  better?: Better;
  spark?: number[];
  sparkTone?: 'in' | 'out';
  /** Una foto de ahora (no del período): lo dice al pie. */
  snapshot?: boolean;
}) {
  const show = (v: number | null | undefined) => (v == null ? '—' : kind === 'duration' ? f.dur(v) : f.num(v));
  const d = kpi.prev === undefined ? null : delta(kpi.value, kpi.prev);
  const tone = d == null || d === 0 || better === 'none' ? 'flat' : d > 0 === (better === 'up') ? 'good' : 'bad';
  let foot: ReactNode = null;
  if (snapshot) foot = f.t('analytics.rightNow');
  else if (kpi.prev === undefined) foot = null;
  else if (d != null) {
    foot = (
      <>
        <span className="la-delta" data-tone={tone}>
          {new Intl.NumberFormat(f.locale, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(d)}
        </span>
        <span>{f.t('analytics.before', { value: show(kpi.prev) })}</span>
      </>
    );
  } else if (kpi.prev != null && kpi.value != null && (kpi.prev !== 0 || kpi.value !== 0)) foot = f.t('analytics.before', { value: show(kpi.prev) });
  return (
    <div className="la-kpi" style={{ '--i': i } as CSSProperties} data-kpi={label}>
      <span className="la-kpi-label">{label}</span>
      <strong className="la-kpi-value">
        {kpi.value == null ? '—' : kind === 'duration' ? f.dur(kpi.value) : <CountUp value={kpi.value} locale={f.locale} decimals={kind === 'decimal' ? 1 : 0} />}
      </strong>
      <span className="la-kpi-foot">{foot}</span>
      {spark && <Sparkline values={spark} tone={sparkTone} />}
    </div>
  );
}

/** Las tarjetas en filas parejas: hasta 5 en una fila; 6 en 3 + 3; 7 y 8 en 4 por fila. */
function Kpis({ children }: { children: ReactNode[] }) {
  const n = children.length;
  const cols = n <= 5 ? n : n === 6 ? 3 : 4;
  return (
    <div className="la-kpis" style={{ '--cols': cols } as CSSProperties}>
      {children}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
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

function BarList({ rows, tone, empty }: { rows: Array<{ key: string; label: ReactNode; value: string; extra?: string; sub?: string; share: number }>; tone?: 'ink'; empty: string }) {
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

const pct = (f: Fmt, part: number, total: number) => new Intl.NumberFormat(f.locale, { style: 'percent', maximumFractionDigits: 0 }).format(share(part, total));

function volumeSeries(f: Fmt, perDay: DayPoint[], prevPerDay: DayPoint[]) {
  return [
    { name: f.t('analytics.inbound'), values: perDay.map((p) => p.inbound), compare: prevPerDay.map((p) => p.inbound) },
    { name: f.t('analytics.outbound'), values: perDay.map((p) => p.outbound), compare: prevPerDay.map((p) => p.outbound) },
  ];
}

const chartAria = (f: Fmt, title: string, d: AnalyticsData) => f.t('analytics.chartAria', { title, from: d.range.from, to: d.range.to });

function lineName(f: Fmt, l: LineStat) {
  return l.name ?? f.t('analytics.removedLine');
}

/** Lunes a domingo, cortos, en el idioma de quien mira (el 1 de enero de 2024 fue lunes). */
function weekdays(locale: string, style: 'short' | 'long'): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

function Heatmap({ f, data }: { f: Fmt; data: number[][] }) {
  const max = Math.max(0, ...data.flat());
  if (max === 0) return <p className="la-panel-empty">{f.t('analytics.heatNone')}</p>;
  const short = weekdays(f.locale, 'short');
  const long = weekdays(f.locale, 'long');
  let peak = { d: 0, h: 0, v: -1 };
  data.forEach((row, d) => row.forEach((v, h) => (v > peak.v ? (peak = { d, h, v }) : null)));
  return (
    <>
      <div className="la-heat" role="img" aria-label={f.t('analytics.heatPeak', { day: long[peak.d], hour: hourLabel(peak.h), n: f.num(peak.v) })}>
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
        {f.t('analytics.heatLess')}
        {[0, 0.3, 0.55, 0.8, 1].map((v) => (
          <i key={v} style={{ '--v': v } as CSSProperties} aria-hidden="true" />
        ))}
        {f.t('analytics.heatMore')}
      </p>
      <p className="la-panel-note">{f.t('analytics.heatPeak', { day: long[peak.d], hour: hourLabel(peak.h), n: f.num(peak.v) })}</p>
    </>
  );
}

function LinesBars({ f, lines }: { f: Fmt; lines: LineStat[] }) {
  const max = Math.max(1, ...lines.map((l) => l.inbound + l.outbound));
  return (
    <BarList
      empty={f.t('analytics.noneInPeriod')}
      rows={lines.slice(0, 8).map((l) => ({
        key: l.id ?? 'removed',
        label: lineName(f, l),
        value: f.num(l.inbound + l.outbound),
        sub: f.t('analytics.inOut', { inbound: f.num(l.inbound), outbound: f.num(l.outbound) }),
        share: (l.inbound + l.outbound) / max,
      }))}
    />
  );
}

const chatLink = (id: string, name: string) => <Link href={`/app/lines/inbox/${id}`}>{name}</Link>;

// ---------- Pestañas ----------

function Overview({ f, d }: { f: Fmt; d: OverviewData }) {
  const k = d.kpis;
  const title = f.t('analytics.volume');
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.inbound')} kpi={k.inbound} spark={d.perDay.map((p) => p.inbound)} />
        <KpiTile f={f} i={1} label={f.t('analytics.outbound')} kpi={k.outbound} spark={d.perDay.map((p) => p.outbound)} sparkTone="out" />
        <KpiTile f={f} i={2} label={f.t('analytics.activeChats')} kpi={k.activeChats} />
        <KpiTile f={f} i={3} label={f.t('analytics.newChats')} kpi={k.newChats} />
        <KpiTile f={f} i={4} label={f.t('analytics.firstResponse')} kpi={k.firstResponseMin} kind="duration" better="down" />
        <KpiTile f={f} i={5} label={f.t('analytics.awaiting')} kpi={k.awaiting} snapshot />
        <KpiTile f={f} i={6} label={f.t('analytics.ticketsCreated')} kpi={k.ticketsCreated} />
        <KpiTile f={f} i={7} label={f.t('analytics.openTickets')} kpi={k.openTickets} snapshot />
      </Kpis>
      <Panel title={title}>
        <TrendChart labels={d.perDay.map((p) => f.day(p.day))} series={volumeSeries(f, d.perDay, d.prevPerDay)} summary={chartAria(f, title, d)} locale={f.locale} compareLabel={f.t('analytics.previous')} />
      </Panel>
      <div className="la-grid">
        <Panel title={f.t('analytics.byLine')}>
          <LinesBars f={f} lines={d.lines} />
        </Panel>
        <Panel title={f.t('analytics.topChats')}>
          {d.topChats.length === 0 ? (
            <p className="la-panel-empty">{f.t('analytics.noneInPeriod')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table la-table">
                <thead>
                  <tr>
                    <th>{f.t('analytics.chat')}</th>
                    <th className="num">{f.t('analytics.inbound')}</th>
                    <th className="num">{f.t('analytics.outbound')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topChats.map((c) => (
                    <tr key={c.id}>
                      <td>{chatLink(c.id, c.name)}</td>
                      <td className="num">{f.num(c.inbound)}</td>
                      <td className="num">{f.num(c.outbound)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function Conversations({ f, d }: { f: Fmt; d: ConversationsData }) {
  const k = d.kpis;
  const total = d.lines.reduce((a, l) => a + l.inbound + l.outbound, 0);
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.inbound')} kpi={k.inbound} />
        <KpiTile f={f} i={1} label={f.t('analytics.outbound')} kpi={k.outbound} />
        <KpiTile f={f} i={2} label={f.t('analytics.activeChats')} kpi={k.activeChats} />
        <KpiTile f={f} i={3} label={f.t('analytics.newChats')} kpi={k.newChats} />
        <KpiTile f={f} i={4} label={f.t('analytics.newGroups')} kpi={k.newGroups} />
        <KpiTile f={f} i={5} label={f.t('analytics.perChat')} kpi={k.perChat} kind="decimal" />
      </Kpis>
      <Panel title={f.t('analytics.volumeBars')}>
        <TrendChart
          kind="bars"
          labels={d.perDay.map((p) => f.day(p.day))}
          series={[
            { name: f.t('analytics.inbound'), values: d.perDay.map((p) => p.inbound) },
            { name: f.t('analytics.outbound'), values: d.perDay.map((p) => p.outbound) },
          ]}
          summary={chartAria(f, f.t('analytics.volumeBars'), d)}
          locale={f.locale}
        />
      </Panel>
      <div className="la-grid">
        <Panel title={f.t('analytics.heatmap')}>
          <Heatmap f={f} data={d.heatmap} />
        </Panel>
        <Panel title={f.t('analytics.newPerDay')}>
          <TrendChart labels={d.newPerDay.map((p) => f.day(p.day))} series={[{ name: f.t('analytics.newChats'), values: d.newPerDay.map((p) => p.value) }]} height={200} summary={chartAria(f, f.t('analytics.newPerDay'), d)} locale={f.locale} />
        </Panel>
      </div>
      <Panel title={f.t('analytics.byLine')}>
        {d.lines.length === 0 ? (
          <p className="la-panel-empty">{f.t('analytics.noneInPeriod')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table gr-table la-table">
              <thead>
                <tr>
                  <th>{f.t('analytics.line')}</th>
                  <th className="num">{f.t('analytics.inbound')}</th>
                  <th className="num">{f.t('analytics.outbound')}</th>
                  <th className="num">{f.t('analytics.activeChats')}</th>
                  <th className="num">{f.t('analytics.shareCol')}</th>
                  <th className="num">{f.t('analytics.previous')}</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id ?? 'removed'}>
                    <td className={l.name ? undefined : 'la-muted'}>{lineName(f, l)}</td>
                    <td className="num">{f.num(l.inbound)}</td>
                    <td className="num">{f.num(l.outbound)}</td>
                    <td className="num">{f.num(l.activeChats)}</td>
                    <td className="num">{pct(f, l.inbound + l.outbound, total)}</td>
                    <td className="num">{f.num(l.prevTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Response({ f, d }: { f: Fmt; d: ResponseData }) {
  const k = d.kpis;
  const responses = d.buckets.reduce((a, b) => a + b, 0);
  const maxBucket = Math.max(1, ...d.buckets);
  const waitingTotal = d.waitingAges.reduce((a, b) => a + b, 0);
  const maxAge = Math.max(1, ...d.waitingAges);
  const title = f.t('analytics.frPerDay');
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.firstResponse')} kpi={k.medianMin} kind="duration" better="down" />
        <KpiTile f={f} i={1} label={f.t('analytics.firstResponseP90')} kpi={k.p90Min} kind="duration" better="down" />
        <KpiTile f={f} i={2} label={f.t('analytics.responses')} kpi={k.responses} />
        <KpiTile f={f} i={3} label={f.t('analytics.unanswered')} kpi={k.unanswered} />
        <KpiTile f={f} i={4} label={f.t('analytics.awaiting')} kpi={k.awaiting} snapshot />
        <KpiTile f={f} i={5} label={f.t('analytics.resolution')} kpi={k.resolutionMin} kind="duration" better="down" />
        <KpiTile f={f} i={6} label={f.t('analytics.breached')} kpi={k.breached} better="down" />
      </Kpis>
      <div className="la-grid">
        <Panel title={title} note={f.t('analytics.note')}>
          {responses === 0 ? (
            <p className="la-panel-empty">{f.t('analytics.noResponses')}</p>
          ) : (
            <TrendChart labels={d.perDay.map((p) => f.day(p.day))} series={[{ name: f.t('analytics.firstResponse'), values: d.perDay.map((p) => p.medianMin) }]} summary={chartAria(f, title, d)} locale={f.locale} unit={f.t('analytics.minUnit')} height={220} />
          )}
        </Panel>
        <Panel title={f.t('analytics.frBuckets')}>
          <BarList
            empty={f.t('analytics.noResponses')}
            rows={
              responses === 0
                ? []
                : d.buckets.map((n, i) => ({
                    key: String(i),
                    label: f.t(`analytics.buckets.b${i}`),
                    value: f.num(n),
                    extra: pct(f, n, responses),
                    share: n / maxBucket,
                  }))
            }
          />
        </Panel>
      </div>
      <div className="la-grid">
        <Panel title={f.t('analytics.waitingAges')}>
          <BarList
            tone="ink"
            empty={f.t('analytics.noWaiting')}
            rows={waitingTotal === 0 ? [] : d.waitingAges.map((n, i) => ({ key: String(i), label: f.t(`analytics.ages.a${i}`), value: f.num(n), share: n / maxAge }))}
          />
        </Panel>
        <Panel title={f.t('analytics.waitingList')}>
          {d.waiting.length === 0 ? (
            <p className="la-panel-empty">{f.t('analytics.noWaiting')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table la-table">
                <thead>
                  <tr>
                    <th>{f.t('analytics.chat')}</th>
                    <th className="num">{f.t('analytics.waitingSince')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.waiting.map((w) => (
                    <tr key={w.id}>
                      <td>{chatLink(w.id, w.name)}</td>
                      <td className="num">{f.dateTime(w.since)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function senderName(f: Fmt, a: AgentStat): string {
  if (a.kind === 'phone') return f.t('analytics.senders.phone');
  if (a.kind === 'ai') return f.t('analytics.senders.ai');
  if (a.kind === 'auto') return f.t('analytics.senders.auto');
  return a.name ?? f.t('analytics.senders.former');
}

function Team({ f, d }: { f: Fmt; d: TeamData }) {
  const k = d.kpis;
  const senders = d.agents.filter((a) => a.sent > 0);
  const max = Math.max(1, ...senders.map((a) => a.sent));
  const total = senders.reduce((a, s) => a + s.sent, 0);
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.people')} kpi={k.people} />
        <KpiTile f={f} i={1} label={f.t('analytics.sentByPeople')} kpi={k.sent} />
        <KpiTile f={f} i={2} label={f.t('analytics.perPerson')} kpi={k.perPerson} />
        <KpiTile f={f} i={3} label={f.t('analytics.assignments')} kpi={k.assignments} />
        <KpiTile f={f} i={4} label={f.t('analytics.unassigned')} kpi={k.unassigned} snapshot />
      </Kpis>
      <Panel title={f.t('analytics.sentBySender')}>
        <BarList
          empty={f.t('analytics.noAgents')}
          rows={senders.slice(0, 12).map((a) => ({ key: a.key, label: senderName(f, a), value: f.num(a.sent), extra: pct(f, a.sent, total), share: a.sent / max }))}
        />
      </Panel>
      <Panel title={f.t('analytics.byAgent')} note={f.t('analytics.teamNote')}>
        <div className="table-wrap">
          <table className="table gr-table la-table">
            <thead>
              <tr>
                <th>{f.t('analytics.person')}</th>
                <th className="num">{f.t('analytics.outbound')}</th>
                <th className="num">{f.t('analytics.chats')}</th>
                <th className="num">{f.t('analytics.responses')}</th>
                <th className="num">{f.t('analytics.firstResponse')}</th>
                <th className="num">{f.t('analytics.assigned')}</th>
                <th className="num">{f.t('analytics.closed')}</th>
                <th className="num">{f.t('analytics.openChats')}</th>
                <th className="num">{f.t('analytics.resolved')}</th>
              </tr>
            </thead>
            <tbody>
              {d.agents.map((a) => (
                <tr key={a.key}>
                  <td className={a.kind === 'person' && a.name ? undefined : 'la-muted'}>{senderName(f, a)}</td>
                  <td className="num">{f.num(a.sent)}</td>
                  <td className="num">{f.num(a.chats)}</td>
                  <td className="num">{f.num(a.responses)}</td>
                  <td className="num">{f.dur(a.medianMin)}</td>
                  <td className="num">{a.kind === 'person' ? f.num(a.assigned) : '—'}</td>
                  <td className="num">{a.kind === 'person' ? f.num(a.closed) : '—'}</td>
                  <td className="num">{a.kind === 'person' ? f.num(a.openChats) : '—'}</td>
                  <td className="num">{a.kind === 'person' ? f.num(a.ticketsResolved) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function Groups({ f, d }: { f: Fmt; d: GroupsData }) {
  const k = d.kpis;
  const title = f.t('analytics.groupsPerDay');
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.groupsTotal')} kpi={k.groups} snapshot />
        <KpiTile f={f} i={1} label={f.t('analytics.activeGroups')} kpi={k.active} />
        <KpiTile f={f} i={2} label={f.t('analytics.quietGroups')} kpi={k.quiet} />
        <KpiTile f={f} i={3} label={f.t('analytics.groupMessages')} kpi={k.messages} />
        <KpiTile f={f} i={4} label={f.t('analytics.members')} kpi={k.members} snapshot />
      </Kpis>
      <Panel title={title}>
        <TrendChart labels={d.perDay.map((p) => f.day(p.day))} series={volumeSeries(f, d.perDay, d.prevPerDay)} summary={chartAria(f, title, d)} locale={f.locale} compareLabel={f.t('analytics.previous')} />
      </Panel>
      <Panel title={f.t('analytics.topGroups')} note={f.t('analytics.groupsNote')}>
        {d.top.length === 0 ? (
          <p className="la-panel-empty">{f.t('analytics.noGroupActivity')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table gr-table la-table">
              <thead>
                <tr>
                  <th>{f.t('analytics.groupCol')}</th>
                  <th className="num">{f.t('analytics.members')}</th>
                  <th className="num">{f.t('analytics.inbound')}</th>
                  <th className="num">{f.t('analytics.outbound')}</th>
                  <th className="num">{f.t('analytics.lastMessage')}</th>
                </tr>
              </thead>
              <tbody>
                {d.top.map((g) => (
                  <tr key={g.id}>
                    <td>{chatLink(g.id, g.name)}</td>
                    <td className="num">{g.members ? f.num(g.members) : '—'}</td>
                    <td className="num">{f.num(g.inbound)}</td>
                    <td className="num">{f.num(g.outbound)}</td>
                    <td className="num">{g.lastAt ? f.dateTime(g.lastAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Broadcasts({ f, d }: { f: Fmt; d: BroadcastsData }) {
  const k = d.kpis;
  const fn = d.funnel;
  const steps: Array<[string, number]> = [
    ['sent', fn.sent],
    ['delivered', fn.delivered],
    ['read', fn.read],
    ['replied', fn.replied],
  ];
  const cell = (v: number | null) => (v == null ? '—' : f.num(v));
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.broadcastsSent')} kpi={k.broadcasts} />
        <KpiTile f={f} i={1} label={f.t('analytics.recipients')} kpi={k.recipients} />
        <KpiTile f={f} i={2} label={f.t('analytics.delivered0')} kpi={k.sent} />
        <KpiTile f={f} i={3} label={f.t('analytics.failed')} kpi={k.failed} better="down" />
      </Kpis>
      <Panel title={f.t('analytics.funnel')} note={f.t('analytics.funnelNote', { n: fn.broadcasts })}>
        <BarList
          empty={f.t('analytics.noReceipts')}
          rows={
            fn.sent === 0
              ? []
              : steps.map(([key, n]) => ({ key, label: f.t(`analytics.steps.${key}`), value: f.num(n), extra: key === 'sent' ? undefined : pct(f, n, fn.sent), share: n / Math.max(1, fn.sent) }))
          }
        />
      </Panel>
      <Panel title={f.t('analytics.broadcastsTable')}>
        <div className="table-wrap">
          <table className="table gr-table la-table">
            <thead>
              <tr>
                <th>{f.t('analytics.broadcastCol')}</th>
                <th className="num">{f.t('analytics.date')}</th>
                <th className="num">{f.t('analytics.recipients')}</th>
                <th className="num">{f.t('analytics.steps.sent')}</th>
                <th className="num">{f.t('analytics.failed')}</th>
                <th className="num">{f.t('analytics.steps.delivered')}</th>
                <th className="num">{f.t('analytics.steps.read')}</th>
                <th className="num">{f.t('analytics.steps.replied')}</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/app/lines/broadcasts/${b.id}`}>{b.name || f.t('analytics.untitled')}</Link>
                  </td>
                  <td className="num">{f.dateTime(b.at)}</td>
                  <td className="num">{f.num(b.total)}</td>
                  <td className="num">{f.num(b.sent)}</td>
                  <td className="num">{f.num(b.failed)}</td>
                  <td className="num">{cell(b.delivered)}</td>
                  <td className="num">{cell(b.read)}</td>
                  <td className="num">{cell(b.replied)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function Tickets({ f, d }: { f: Fmt; d: TicketsData }) {
  const k = d.kpis;
  const title = f.t('analytics.ticketsPerDay');
  const split = (rows: Array<{ key: string; value: number }>, ns: string) => {
    const max = Math.max(1, ...rows.map((r) => r.value));
    const total = rows.reduce((a, r) => a + r.value, 0);
    return rows.map((r) => ({ key: r.key, label: f.t(`${ns}.${r.key}`), value: f.num(r.value), extra: pct(f, r.value, total), share: r.value / max }));
  };
  // En el orden natural de cada lista (urgente primero, abierto primero), no por cantidad.
  const known = (rows: Array<{ key: string; value: number }>, keys: string[]) => keys.flatMap((k) => rows.filter((r) => r.key === k));
  const hasTickets = Boolean(k.created.value || k.resolved.value);
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.ticketsCreated')} kpi={k.created} />
        <KpiTile f={f} i={1} label={f.t('analytics.ticketsResolved')} kpi={k.resolved} better="up" />
        <KpiTile f={f} i={2} label={f.t('analytics.openTickets')} kpi={k.open} snapshot />
        <KpiTile f={f} i={3} label={f.t('analytics.resolution')} kpi={k.resolutionMin} kind="duration" better="down" />
        <KpiTile f={f} i={4} label={f.t('analytics.breached')} kpi={k.breached} better="down" />
        <KpiTile f={f} i={5} label={f.t('analytics.tasksCreated')} kpi={k.tasksCreated} />
        <KpiTile f={f} i={6} label={f.t('analytics.tasksOpen')} kpi={k.tasksOpen} snapshot />
        <KpiTile f={f} i={7} label={f.t('analytics.tasksOverdue')} kpi={k.tasksOverdue} snapshot />
      </Kpis>
      <Panel title={title}>
        {hasTickets ? (
          <TrendChart
            labels={d.perDay.map((p) => f.day(p.day))}
            series={[
              { name: f.t('analytics.seriesCreated'), values: d.perDay.map((p) => p.created) },
              { name: f.t('analytics.seriesResolved'), values: d.perDay.map((p) => p.resolved) },
            ]}
            summary={chartAria(f, title, d)}
            locale={f.locale}
            height={220}
          />
        ) : (
          <p className="la-panel-empty">{f.t('analytics.noTickets')}</p>
        )}
      </Panel>
      <div className="la-grid">
        <Panel title={f.t('analytics.byPriority')}>
          <BarList empty={f.t('analytics.noTickets')} rows={split(known(d.byPriority, ['urgent', 'high', 'medium', 'low']), 'priority')} />
        </Panel>
        <Panel title={f.t('analytics.byStatus')}>
          <BarList tone="ink" empty={f.t('analytics.noTickets')} rows={split(known(d.byStatus, ['open', 'in_progress', 'resolved', 'closed']), 'ticketStatus')} />
        </Panel>
      </div>
      <Panel title={f.t('analytics.bySource')}>
        <BarList tone="ink" empty={f.t('analytics.noTickets')} rows={split(known(d.bySource, ['manual', 'reaction', 'keyword', 'api', 'flow']), 'tickets.source')} />
      </Panel>
    </>
  );
}

function Labels({ f, d }: { f: Fmt; d: LabelsData }) {
  const k = d.kpis;
  const withMessages = d.rows.filter((l) => l.inbound + l.outbound > 0);
  const max = Math.max(1, ...withMessages.map((l) => l.inbound + l.outbound));
  return (
    <>
      <Kpis>
        <KpiTile f={f} i={0} label={f.t('analytics.labelsInUse')} kpi={k.labels} snapshot />
        <KpiTile f={f} i={1} label={f.t('analytics.labelled')} kpi={k.labelled} snapshot />
        <KpiTile f={f} i={2} label={f.t('analytics.unlabelled')} kpi={k.unlabelled} snapshot />
      </Kpis>
      <Panel title={f.t('analytics.labelMessages')}>
        <BarList
          empty={f.t('analytics.noneInPeriod')}
          rows={withMessages.slice(0, 12).map((l) => ({
            key: l.id,
            label: l.name,
            value: f.num(l.inbound + l.outbound),
            sub: f.t('analytics.inOut', { inbound: f.num(l.inbound), outbound: f.num(l.outbound) }),
            share: (l.inbound + l.outbound) / max,
          }))}
        />
      </Panel>
      <Panel title={f.t('analytics.byLabel')} note={f.t('analytics.labelsNote')}>
        <div className="table-wrap">
          <table className="table gr-table la-table">
            <thead>
              <tr>
                <th>{f.t('inbox.label')}</th>
                <th className="num">{f.t('analytics.chats')}</th>
                <th className="num">{f.t('analytics.awaiting')}</th>
                <th className="num">{f.t('analytics.activeChats')}</th>
                <th className="num">{f.t('analytics.inbound')}</th>
                <th className="num">{f.t('analytics.outbound')}</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td className="num">{f.num(l.chats)}</td>
                  <td className="num">{f.num(l.awaiting)}</td>
                  <td className="num">{f.num(l.activeChats)}</td>
                  <td className="num">{f.num(l.inbound)}</td>
                  <td className="num">{f.num(l.outbound)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export function AnalyticsView({ f, data }: { f: Fmt; data: AnalyticsData }) {
  switch (data.tab) {
    case 'overview':
      return <Overview f={f} d={data} />;
    case 'conversations':
      return <Conversations f={f} d={data} />;
    case 'response':
      return <Response f={f} d={data} />;
    case 'team':
      return <Team f={f} d={data} />;
    case 'groups':
      return <Groups f={f} d={data} />;
    case 'broadcasts':
      return <Broadcasts f={f} d={data} />;
    case 'tickets':
      return <Tickets f={f} d={data} />;
    case 'labels':
      return <Labels f={f} d={data} />;
  }
}

