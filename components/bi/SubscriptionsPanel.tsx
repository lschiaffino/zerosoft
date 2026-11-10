'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import LocalDate from '@/components/ui/LocalDate';
import BiDialog from './BiDialog';
import { biApi, biErrorText } from './client';
import type { SubscriptionDto } from '@/lib/bi/subscriptions';

/** Suscripciones del tablero: resumen por email (personas del workspace) o a un canal de Talk. */
export default function SubscriptionsPanel({ open, onClose, dashboardId }: { open: boolean; onClose: () => void; dashboardId: string }) {
  const t = useTranslations('bi');
  const locale = useLocale();
  const [subs, setSubs] = useState<SubscriptionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<'email' | 'talk'>('email');
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('weekly');

  useEffect(() => {
    if (!open) return;
    setError(null);
    biApi<{ subscriptions: SubscriptionDto[] }>(`/api/bi/dashboards/${dashboardId}/subscriptions`)
      .then((d) => setSubs(d.subscriptions))
      .catch((err) => {
        setSubs([]);
        setError(biErrorText(err, t));
      });
  }, [open, dashboardId, t]);

  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, label: new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + d))) }));
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

  return (
    <BiDialog open={open} title={t('subs.title')} onClose={onClose} wide>
      <div className="ui-modal-body ui-fields">
        <p className="bi-muted">{t('subs.body')}</p>
        {subs === null ? (
          <p className="bi-muted" role="status">
            {t('common.loading')}
          </p>
        ) : subs.length === 0 ? (
          <p className="bi-muted">{t('subs.none')}</p>
        ) : (
          <ul className="bi-share-list" role="list" data-testid="bi-subs">
            {subs.map((s) => (
              <li key={s.id}>
                <span>
                  {s.channel === 'email' ? t('subs.toEmail', { target: s.target }) : t('subs.toTalk')} · {s.cadence === 'daily' ? t('subs.daily') : t('subs.weekly')} · {String(s.hour).padStart(2, '0')}:00 {s.timezone}
                  <br />
                  <span className="bi-muted">
                    {t('subs.next')} <LocalDate value={s.nextRunAt} locale={locale} />
                    {s.lastError ? ` · ${t('subs.lastError')}` : ''}
                  </span>
                </span>
                {s.canEdit && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await biApi(`/api/bi/subscriptions/${s.id}`, { method: 'DELETE' });
                        setSubs((l) => (l ?? []).filter((x) => x.id !== s.id));
                      } catch (err) {
                        setError(biErrorText(err, t));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t('common.delete')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className="bi-sub-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            setBusy(true);
            setError(null);
            try {
              const { subscription } = await biApi<{ subscription: SubscriptionDto }>(`/api/bi/dashboards/${dashboardId}/subscriptions`, {
                body: {
                  channel,
                  target: String(fd.get('target') ?? ''),
                  cadence,
                  hour: Number(fd.get('hour')),
                  weekday: Number(fd.get('weekday') ?? 1),
                  timezone: tz,
                },
              });
              setSubs((l) => [...(l ?? []), subscription]);
              form.reset();
            } catch (err) {
              setError(biErrorText(err, t));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3 className="bi-h3">{t('subs.new')}</h3>
          <div className="bi-row">
            <label className="bi-inline-field">
              <span className="label">{t('subs.channel')}</span>
              <select className="input" value={channel} onChange={(e) => setChannel(e.target.value as 'email' | 'talk')}>
                <option value="email">{t('subs.email')}</option>
                <option value="talk">{t('subs.talk')}</option>
              </select>
            </label>
            <label className="bi-inline-field bi-grow">
              <span className="label">{channel === 'email' ? t('subs.recipients') : t('subs.talkChannel')}</span>
              <input className="input" name="target" required maxLength={1000} placeholder={channel === 'email' ? 'ana@example.com' : '#general'} />
            </label>
          </div>
          <div className="bi-row">
            <label className="bi-inline-field">
              <span className="label">{t('subs.cadence')}</span>
              <select className="input" value={cadence} onChange={(e) => setCadence(e.target.value as 'daily' | 'weekly')}>
                <option value="daily">{t('subs.daily')}</option>
                <option value="weekly">{t('subs.weekly')}</option>
              </select>
            </label>
            {cadence === 'weekly' && (
              <label className="bi-inline-field">
                <span className="label">{t('subs.day')}</span>
                <select className="input" name="weekday" defaultValue="1">
                  {days.map((d) => (
                    <option key={d.d} value={d.d}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="bi-inline-field">
              <span className="label">{t('subs.hour')}</span>
              <select className="input" name="hour" defaultValue="9">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="bi-muted">{channel === 'email' ? t('subs.emailHint') : t('subs.talkHint')}</p>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <div className="bi-actions">
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy} aria-busy={busy}>
              {t('subs.create')}
            </button>
          </div>
        </form>
      </div>
      <div className="ui-modal-foot">
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </BiDialog>
  );
}
