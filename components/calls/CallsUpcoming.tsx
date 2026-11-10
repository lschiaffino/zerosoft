'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { UpcomingEvent } from '@/lib/calls/schedule';
import type { AutoJoinRule } from '@/lib/calls/types';
import NewCallDialog from './NewCallDialog';
import { api, useDate, useErrorText, useToast } from './ui';

interface Data {
  events: UpcomingEvent[];
  rule: AutoJoinRule;
  calendarConnected: boolean;
  botConfigured: boolean;
}

const RULES: AutoJoinRule[] = ['external', 'deals', 'all', 'manual'];

/**
 * Próximas reuniones del calendario (7 días): la regla de la persona, qué
 * hace el bot en cada una y el interruptor por reunión. Se carga en el
 * cliente: el calendario puede tardar.
 */
export default function CallsUpcoming() {
  const t = useTranslations('calls.upcoming');
  const tn = useTranslations('calls');
  const date = useDate();
  const err = useErrorText();
  const [toast, push] = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await api<Data>('/api/calls/upcoming');
    if (!res.ok) return setError(err(res.data.error));
    setData(res.data);
  }, [err]);

  useEffect(() => {
    void load();
  }, [load]);

  const setRule = async (rule: AutoJoinRule) => {
    if (!data) return;
    setData({ ...data, rule });
    const res = await api('/api/calls/settings', { method: 'PUT', json: { autoJoin: rule } });
    if (!res.ok) return push(err(res.data.error), 'bad');
    push(t('ruleSaved'));
    void load();
  };

  const toggle = async (e: UpcomingEvent, on: boolean) => {
    if (!data) return;
    setBusyKey(e.key);
    const res = await api<{ event?: UpcomingEvent | null }>('/api/calls/upcoming', { method: 'PUT', json: { key: e.key, mode: on ? 'on' : 'off' } });
    setBusyKey(null);
    if (!res.ok) return push(err(res.data.error), 'bad');
    const next = res.data.event;
    setData({ ...data, events: data.events.map((x) => (x.key === e.key && next ? next : x)) });
  };

  return (
    <div className="app-page ui-page cl-page">
      {toast}
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)} data-testid="calls-upcoming-new">
            {t('sendNow')}
          </button>
        }
      />
      {error ? (
        <div className="ui-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      ) : !data ? (
        <div className="ui-loading-stack" aria-busy="true">
          <span className="sr-only" role="status">
            {t('loading')}
          </span>
          {[0, 1, 2].map((i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : (
        <>
          {!data.botConfigured && <p className="cl-note">{tn('new.botMissing')}</p>}
          <fieldset className="cl-rules" data-testid="calls-rule">
            <legend>{t('ruleLabel')}</legend>
            {RULES.map((r) => (
              <label key={r} className="cl-rule">
                <input type="radio" name="cl-rule" value={r} checked={data.rule === r} onChange={() => void setRule(r)} />
                <span>
                  <strong>{t(`rules.${r}`)}</strong>
                  <small>{t(`rulesHelp.${r}`)}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {!data.calendarConnected ? (
            <EmptyState
              product="calls"
              title={t('connectTitle')}
              body={t('connectBody')}
              action={{ label: t('connectAction'), href: '/app/calendar/settings' }}
              secondary={
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewOpen(true)}>
                  {t('sendNow')}
                </button>
              }
            />
          ) : data.events.length === 0 ? (
            <EmptyState compact title={t('emptyTitle')} body={t('emptyBody')} />
          ) : (
            <ul className="cl-events" data-testid="calls-events">
              {data.events.map((e) => (
                <li key={e.key} className="cl-event" data-testid="calls-event">
                  <div className="cl-event-main">
                    <span className="cl-event-when">{date(e.startsAt)}</span>
                    <strong className="cl-wrap">{e.title || t('untitled')}</strong>
                    <span className="cl-muted">
                      {e.platform ? t(`platform.${e.platform}`) : t('noLink')}
                      {e.attendees.length > 0 && ` · ${t('attendees', { count: e.attendees.length })}`}
                      {e.attendees.length > 0 && ` · ${e.external ? t('external') : t('internal')}`}
                    </span>
                  </div>
                  <div className="cl-event-side">
                    {e.callId && e.status && !['scheduled', 'skipped', 'cancelled'].includes(e.status) ? (
                      <Link className="btn btn-secondary btn-sm" href={`/app/calls/call/${e.callId}`}>
                        {tn(`status.${e.status}`)}
                      </Link>
                    ) : e.supported ? (
                      <label className="ui-switch cl-switch">
                        <input type="checkbox" role="switch" checked={e.willJoin} disabled={busyKey === e.key} onChange={(x) => void toggle(e, x.target.checked)} data-testid="calls-event-toggle" />
                        <span>{e.willJoin ? t('willRecord') : t('wontRecord')}</span>
                      </label>
                    ) : (
                      <span className="cl-muted">{e.platform ? t('unsupported') : t('noLink')}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <NewCallDialog open={newOpen} onClose={() => setNewOpen(false)} botConfigured={data?.botConfigured ?? true} />
    </div>
  );
}
