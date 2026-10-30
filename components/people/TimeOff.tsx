'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { Balance, Holiday } from '@/lib/people-time';
import type { CalendarEntry, Policy, RequestDto } from '@/lib/people-timeoff';
import { Tabs, useToast } from './people-ui';
import RequestDialog from './RequestDialog';
import RequestsTable from './RequestsTable';
import { BalanceCards, useLoad, Loading, LoadError } from './ProfileSections';

type TabKey = 'mine' | 'approvals' | 'calendar' | 'all';

export interface TimeOffProps {
  hr: boolean;
  isManager: boolean;
  hasProfile: boolean;
  balances: Array<{ policy: Policy; balance: Balance }>;
  mine: RequestDto[];
  approvals: RequestDto[];
  tab: string;
  openNew: boolean;
  country: string;
}

export default function TimeOff({ hr, isManager, hasProfile, balances, mine, approvals, tab: initialTab, openNew, country }: TimeOffProps) {
  const t = useTranslations('people');
  const router = useRouter();
  const [toast, push] = useToast();
  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    ...(hasProfile ? [{ key: 'mine' as const, label: t('timeoff.tabs.mine') }] : []),
    ...(hr || isManager ? [{ key: 'approvals' as const, label: t('timeoff.tabs.approvals'), count: approvals.length }] : []),
    { key: 'calendar', label: t('timeoff.tabs.calendar') },
    ...(hr ? [{ key: 'all' as const, label: t('timeoff.tabs.all') }] : []),
  ];
  const [tab, setTab] = useState<TabKey>(tabs.some((x) => x.key === initialTab) ? (initialTab as TabKey) : tabs[0].key);
  const [requesting, setRequesting] = useState(openNew && hasProfile);
  const changeTab = (k: TabKey) => {
    setTab(k);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', k);
    url.searchParams.delete('new');
    window.history.replaceState(null, '', url.toString());
  };
  const changed = (m: string, tone?: 'ok' | 'bad') => {
    push(m, tone);
    router.refresh();
  };

  return (
    <div className="app-page ui-page ppl-page">
      {toast}
      <PageHeader
        title={t('nav.timeOff')}
        description={t('timeoff.desc')}
        actions={
          hasProfile ? (
            <button type="button" className="btn btn-primary" onClick={() => setRequesting(true)}>
              {t('timeoff.request')}
            </button>
          ) : undefined
        }
      />
      <Tabs items={tabs} value={tab} onChange={changeTab} label={t('nav.timeOff')} />
      <div className="ppl-tabpanel" role="tabpanel">
        {tab === 'mine' && (
          <div className="ppl-stack">
            <BalanceCards balances={balances} />
            <RequestsTable requests={mine} showPerson={false} onChange={changed} empty={t('timeoff.noRequests')} />
          </div>
        )}
        {tab === 'approvals' && <RequestsTable requests={approvals} showPerson onChange={changed} empty={t('timeoff.noApprovals')} />}
        {tab === 'calendar' && <TeamCalendar country={country} />}
        {tab === 'all' && <AllRequests onChange={changed} />}
      </div>
      {!hasProfile && <p className="ppl-hint">{t('timeoff.noProfile')}</p>}
      {requesting && (
        <RequestDialog
          open
          policies={balances.map((b) => ({ id: b.policy.id, name: b.policy.name, halfDay: b.policy.halfDay, available: b.policy.accrual === 'none' ? null : b.balance.available }))}
          onClose={() => setRequesting(false)}
          onDone={() => {
            setRequesting(false);
            push(t('timeoff.sent'));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AllRequests({ onChange }: { onChange: (m: string, tone?: 'ok' | 'bad') => void }) {
  const t = useTranslations('people');
  const all = useLoad<{ requests: RequestDto[] }>('/api/people/time-off?scope=all');
  if (all.error) return <LoadError retry={all.reload} />;
  if (!all.data) return <Loading />;
  return (
    <RequestsTable
      requests={all.data.requests}
      showPerson
      empty={t('timeoff.noRequests')}
      onChange={(m, tone) => {
        onChange(m, tone);
        all.reload();
      }}
    />
  );
}

function monthBounds(ym: string): { from: string; to: string; days: string[] } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
  return { from: days[0], to: days[days.length - 1], days };
}

/** Calendario del equipo: un mes en grilla (semana empieza el lunes) con quién está fuera y los feriados. */
function TeamCalendar({ country }: { country: string }) {
  const t = useTranslations('people');
  const locale = useLocale();
  const [ym, setYm] = useState(new Date().toISOString().slice(0, 7));
  const { from, to, days } = useMemo(() => monthBounds(ym), [ym]);
  const data = useLoad<{ entries: CalendarEntry[]; holidays: Holiday[] }>(`/api/people/calendar?from=${from}&to=${to}&country=${country}`);
  const shift = (n: number) => {
    const [y, m] = ym.split('-').map(Number);
    setYm(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  };
  const title = new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }));
  return (
    <section className="ppl-panel" aria-label={t('timeoff.tabs.calendar')}>
      <div className="ppl-panel-head">
        <h2 className="ppl-panel-title ppl-cap">{title}</h2>
        <span className="ppl-panel-actions">
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => shift(-1)} aria-label={t('timeoff.prevMonth')}>
            ‹
          </button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setYm(new Date().toISOString().slice(0, 7))}>
            {t('timeoff.thisMonth')}
          </button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => shift(1)} aria-label={t('timeoff.nextMonth')}>
            ›
          </button>
        </span>
      </div>
      {data.error ? (
        <LoadError retry={data.reload} />
      ) : !data.data ? (
        <Loading />
      ) : (
        <>
          <div className="ppl-cal" data-testid="people-calendar">
            {weekdays.map((w) => (
              <div key={w} className="ppl-cal-wd" aria-hidden="true">
                {w}
              </div>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <div key={`l${i}`} className="ppl-cal-day is-empty" aria-hidden="true" />
            ))}
            {days.map((d) => {
              const out = data.data!.entries.filter((e) => e.startDate <= d && e.endDate >= d);
              const hol = data.data!.holidays.filter((h) => h.date === d);
              const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
              return (
                <div key={d} className={`ppl-cal-day${wd === 0 || wd === 6 ? ' is-weekend' : ''}`} data-day={d}>
                  <span className="ppl-cal-num">{Number(d.slice(8))}</span>
                  {hol.map((h) => (
                    <span key={h.name} className="ppl-cal-hol" title={h.name}>
                      {h.name}
                    </span>
                  ))}
                  {out.map((e) => (
                    <Link
                      key={e.requestId}
                      href={`/app/people/${e.employeeId}`}
                      className={`ppl-cal-out${e.status === 'pending' ? ' is-pending' : ''}`}
                      title={`${e.employeeName}${e.policyName ? ` · ${e.policyName}` : ''}${e.status === 'pending' ? ` · ${t('timeoff.status.pending')}` : ''}`}
                    >
                      {e.employeeName}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
          <h3 className="ppl-subtitle">{t('timeoff.outThisMonth')}</h3>
          {data.data.entries.length === 0 ? (
            <EmptyState compact quiet body={t('timeoff.nobodyOut')} />
          ) : (
            <ul className="ppl-list">
              {data.data.entries.map((e) => (
                <li key={e.requestId}>
                  <Link href={`/app/people/${e.employeeId}`}>{e.employeeName}</Link>
                  <span className="ppl-muted">
                    {' · '}
                    {e.startDate}
                    {e.endDate !== e.startDate && ` · ${e.endDate}`}
                    {e.policyName && ` · ${e.policyName}`}
                    {e.status === 'pending' && ` · ${t('timeoff.status.pending')}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
