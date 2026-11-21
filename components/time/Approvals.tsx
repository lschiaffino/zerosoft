'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { SheetListItem } from '@/lib/time/approvals';
import { addDays, formatMinutes, MAX_SHEET_NOTE, type ReportEntry, type SheetAction } from '@/lib/time/types';
import { SHEET_BADGE } from './SheetStatus';
import { api, TimeDialog, useDayFormat, useErrorText, useToast } from './ui';

type Tab = 'submitted' | 'approved' | 'returned';
const TABS: Tab[] = ['submitted', 'approved', 'returned'];

/**
 * Aprobación de horas. Quien administra ve las semanas enviadas del equipo
 * (pendientes, aprobadas, devueltas), mira el detalle y aprueba, devuelve con
 * una nota o reabre. Un miembro ve el estado de sus semanas enviadas.
 */
export default function Approvals({ admin, initialCount }: { admin: boolean; initialCount: number }) {
  const t = useTranslations('time');
  const errorText = useErrorText();
  const fmtDay = useDayFormat();
  const [toast, push] = useToast();
  const [tab, setTab] = useState<Tab>('submitted');
  const [sheets, setSheets] = useState<SheetListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(initialCount);
  const [busy, setBusy] = useState<string | null>(null);
  const [returning, setReturning] = useState<SheetListItem | null>(null);
  const [note, setNote] = useState('');
  const [viewing, setViewing] = useState<SheetListItem | null>(null);
  const [detail, setDetail] = useState<ReportEntry[] | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const r = await api<{ sheets: SheetListItem[] }>(admin ? `/api/time/approvals?status=${tab}` : '/api/time/approvals');
    if (!r.ok) return setFailed(true);
    setSheets(r.data.sheets);
    if (admin && tab === 'submitted') setPending(r.data.sheets.length);
  }, [admin, tab]);

  useEffect(() => {
    setSheets(null);
    void load();
  }, [load]);

  const keyOf = (s: SheetListItem) => `${s.personId}|${s.week}`;
  const weekLabel = (week: string) => `${fmtDay(week, { day: 'numeric', month: 'short' })} – ${fmtDay(addDays(week, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const act = async (s: SheetListItem, action: SheetAction, withNote = ''): Promise<boolean> => {
    setBusy(keyOf(s));
    const r = await api('/api/time/approvals', { method: 'POST', json: { action, week: s.week, personId: s.personId, ...(withNote ? { note: withNote } : {}) } });
    setBusy(null);
    if (!r.ok) {
      push(errorText(r.data.error), 'bad');
      void load();
      return false;
    }
    setSheets((cur) => cur?.filter((x) => keyOf(x) !== keyOf(s)) ?? cur);
    if (s.status === 'submitted') setPending((n) => Math.max(0, n - 1));
    push(t(`approval.${action}Toast`));
    return true;
  };

  const approveAll = async () => {
    for (const s of sheets ?? []) if (!(await act(s, 'approve'))) break;
  };

  const submitReturn = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!returning) return;
    if (await act(returning, returning.status === 'approved' ? 'reopen' : 'return', note.trim())) setReturning(null);
  };

  const openDetail = async (s: SheetListItem) => {
    setViewing(s);
    setDetail(null);
    const r = await api<{ entries: ReportEntry[] }>(`/api/time/approvals?person=${encodeURIComponent(s.personId)}&week=${s.week}`);
    setDetail(r.ok ? r.data.entries : []);
    if (!r.ok) push(errorText(r.data.error), 'bad');
  };

  const actions = (s: SheetListItem) => {
    const k = keyOf(s);
    return (
      <div className="tm-row-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openDetail(s)} data-testid="time-approval-view">
          {t('approval.view')}
        </button>
        {s.status === 'submitted' && (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void act(s, 'approve')} disabled={busy === k} data-testid="time-approval-approve">
              {t('approval.approve')}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setNote('');
                setReturning(s);
              }}
              disabled={busy === k}
              data-testid="time-approval-return"
            >
              {t('approval.return')}
            </button>
          </>
        )}
        {s.status === 'approved' && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setNote('');
              setReturning(s);
            }}
            disabled={busy === k}
            data-testid="time-approval-reopen"
          >
            {t('approval.reopen')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="app-page ui-page tm-page">
      <PageHeader
        title={t('nav.approvals')}
        description={admin ? t('approval.descAdmin') : t('approval.descMember')}
        actions={
          admin && tab === 'submitted' && (sheets?.length ?? 0) > 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => void approveAll()} disabled={busy !== null} data-testid="time-approval-approve-all">
              {t('approval.approveAll')}
            </button>
          ) : undefined
        }
      />

      {admin && (
        <div className="ui-tabs tm-tabs" role="tablist" aria-label={t('approval.statusLabel')}>
          {TABS.map((x) => (
            <button key={x} type="button" role="tab" className="ui-tab" aria-selected={tab === x} onClick={() => setTab(x)} data-testid={`time-approval-tab-${x}`}>
              {t(`approval.tab.${x}`)}
              {x === 'submitted' && pending > 0 ? <span className="tm-count num">{pending}</span> : null}
            </button>
          ))}
        </div>
      )}

      {failed ? (
        <EmptyState
          compact
          title={t('approval.loadError')}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          }
        />
      ) : !sheets ? (
        <div className="ui-loading-stack" aria-busy="true">
          <span className="sr-only" role="status">
            {t('common.loading')}
          </span>
          {[0, 1, 2].map((i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : sheets.length === 0 ? (
        <EmptyState
          product="time"
          title={admin ? t(`approval.empty.${tab}`) : t('approval.emptyMember')}
          body={admin ? (tab === 'submitted' ? t('approval.emptyPendingBody') : undefined) : t('approval.emptyMemberBody')}
          action={admin ? undefined : { label: t('nav.timesheet'), href: '/app/time?view=week' }}
        />
      ) : (
        <div className="table-wrap">
          <table className="table tm-table" data-testid="time-approval-table">
            <thead>
              <tr>
                {admin && <th scope="col">{t('approval.person')}</th>}
                <th scope="col" className={admin ? 'tm-hide-sm' : undefined}>
                  {t('approval.week')}
                </th>
                {!admin && <th scope="col">{t('approval.statusLabel')}</th>}
                <th scope="col" className="tm-num">
                  {t('reports.hours')}
                </th>
                <th scope="col" className="tm-num tm-hide-sm">
                  {t('reports.billableHours')}
                </th>
                {admin && (
                  <th scope="col" className="tm-num">
                    <span className="sr-only">{t('approval.actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={keyOf(s)} data-testid="time-approval-row" data-person={s.personId} data-week={s.week} data-status={s.status}>
                  {admin && (
                    <th scope="row">
                      <span className="tm-rowtitle">{s.personName}</span>
                      <span className="tm-rowmeta tm-show-sm">{weekLabel(s.week)}</span>
                      {s.status === 'returned' && s.note ? <span className="tm-rowmeta tm-block">“{s.note}”</span> : null}
                    </th>
                  )}
                  <td className={admin ? 'tm-hide-sm' : undefined}>
                    {admin ? (
                      weekLabel(s.week)
                    ) : (
                      <Link className="tm-rowlink" href={`/app/time?date=${s.week}&view=week`}>
                        <span className="tm-rowtitle">{weekLabel(s.week)}</span>
                        {s.status === 'returned' && s.note ? <span className="tm-rowmeta">“{s.note}”</span> : null}
                      </Link>
                    )}
                    {s.decidedAt && s.decidedByName ? (
                      <span className="tm-rowmeta tm-block">
                        {t(s.status === 'approved' ? 'approval.approvedBy' : 'approval.returnedBy', { who: s.decidedByName, date: fmtDay(s.decidedAt.slice(0, 10), { day: 'numeric', month: 'short' }) })}
                      </span>
                    ) : null}
                  </td>
                  {!admin && (
                    <td>
                      <span className={`badge ${SHEET_BADGE[s.status]}`}>{t(`approval.status.${s.status}`)}</span>
                    </td>
                  )}
                  <td className="tm-num num">{formatMinutes(s.minutes)}</td>
                  <td className="tm-num num tm-hide-sm">{formatMinutes(s.billableMinutes)}</td>
                  {admin && <td className="tm-num">{actions(s)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TimeDialog open={returning !== null} title={returning?.status === 'approved' ? t('approval.reopenTitle') : t('approval.returnTitle')} onClose={() => setReturning(null)} testId="time-approval-return-dialog">
        {returning && (
          <form onSubmit={submitReturn}>
            <div className="ui-modal-body ui-fields">
              <p className="tm-muted">{t('approval.returnBody', { who: returning.personName, week: weekLabel(returning.week) })}</p>
              <label className="ui-field">
                <span className="label">{t('approval.note')}</span>
                <textarea className="input tm-notes" rows={3} maxLength={MAX_SHEET_NOTE} value={note} onChange={(e) => setNote(e.target.value)} name="note" autoFocus />
              </label>
            </div>
            <div className="ui-modal-foot tm-dialog-foot">
              <span className="tm-spacer" />
              <button type="button" className="btn btn-ghost" onClick={() => setReturning(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy !== null} data-testid="time-approval-return-submit">
                {returning.status === 'approved' ? t('approval.reopen') : t('approval.return')}
              </button>
            </div>
          </form>
        )}
      </TimeDialog>

      <TimeDialog open={viewing !== null} title={viewing ? `${viewing.personName} · ${weekLabel(viewing.week)}` : ''} onClose={() => setViewing(null)} testId="time-approval-detail">
        {viewing && (
          <>
            <div className="ui-modal-body">
              {!detail ? (
                <div className="ui-loading-stack" aria-busy="true">
                  <span className="ui-skeleton ui-skeleton-row" />
                  <span className="ui-skeleton ui-skeleton-row" />
                </div>
              ) : detail.length === 0 ? (
                <p className="tm-muted">{t('approval.noEntries')}</p>
              ) : (
                <ul className="tm-entries tm-detail-list">
                  {detail.map((e) => (
                    <li key={e.id} className="tm-entry tm-detail-entry" data-testid="time-approval-entry">
                      <div className="tm-entry-main is-locked">
                        <span className="tm-entry-title">
                          <strong>{e.projectName}</strong>
                          {e.clientName ? <span className="tm-muted"> · {e.clientName}</span> : null}
                        </span>
                        <span className="tm-entry-meta">
                          {fmtDay(e.date, { weekday: 'short' })} {fmtDay(e.date, { day: 'numeric' })} · {e.taskName}
                          {e.notes ? <span className="tm-entry-notes"> · {e.notes}</span> : null}
                        </span>
                      </div>
                      <span className="tm-entry-time num">{formatMinutes(e.minutes)}</span>
                    </li>
                  ))}
                  <li className="tm-entries-total">
                    <span>{t('week.total')}</span>
                    <strong className="num">{formatMinutes(detail.reduce((n, e) => n + e.minutes, 0))}</strong>
                  </li>
                </ul>
              )}
            </div>
            <div className="ui-modal-foot tm-dialog-foot">
              <span className="tm-spacer" />
              <button type="button" className="btn btn-ghost" onClick={() => setViewing(null)}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}
      </TimeDialog>
      {toast}
    </div>
  );
}
