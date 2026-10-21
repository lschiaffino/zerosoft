'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Popover } from './InlineEditors';
import TrackIcon from './TrackIcon';
import { formatWhenShort, SNOOZE_PRESETS, snoozeAt, toDatetimeLocal, type SnoozePreset } from '@/lib/track-snooze';

interface IssueReminderProps {
  issueId: string;
  locale: string;
  initial: { remindAt: string; sentAt: string | null } | null;
}

const PRESET_LABEL: Record<SnoozePreset, 'reminder.inHour' | 'reminder.tomorrow' | 'reminder.nextWeek'> = {
  hour: 'reminder.inHour',
  tomorrow: 'reminder.tomorrow',
  nextWeek: 'reminder.nextWeek',
};

/**
 * "Recordarme" en un issue: a la hora elegida llega un aviso a la bandeja de
 * Track (y el email según los ajustes de la persona). Es personal: cada uno
 * tiene el suyo por issue.
 */
export default function IssueReminder({ issueId, locale, initial }: IssueReminderProps) {
  const t = useTranslations('track');
  const [reminder, setReminder] = useState(initial && !initial.sentAt ? initial : null);
  const [custom, setCustom] = useState(() => toDatetimeLocal(snoozeAt('tomorrow', new Date())));
  const [error, setError] = useState<string | null>(null);

  async function save(at: Date | null) {
    setError(null);
    const res = await fetch(`/api/track/issues/${issueId}/reminder`, {
      method: at ? 'PUT' : 'DELETE',
      headers: at ? { 'Content-Type': 'application/json' } : undefined,
      body: at ? JSON.stringify({ remindAt: at.toISOString() }) : undefined,
    }).catch(() => null);
    if (!res?.ok) {
      const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : null;
      setError(code === 'reminder_in_past' ? t('reminder.past') : t('reminder.error'));
      return;
    }
    const data = (await res.json()) as { reminder: { remindAt: string; sentAt: string | null } | null };
    setReminder(data.reminder);
  }

  const label = reminder ? t('reminder.active', { when: formatWhenShort(reminder.remindAt, locale) }) : t('reminder.button');

  return (
    <>
      <Popover
        ariaLabel={label}
        className="btn"
        width={260}
        trigger={
          <>
            <TrackIcon name="clock" />
            <span data-testid="track-issue-reminder">{label}</span>
          </>
        }
      >
        {(close) => (
          <>
            {SNOOZE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitem"
                className="track-menu-item"
                onClick={() => {
                  close();
                  void save(snoozeAt(p, new Date()));
                }}
              >
                <span className="track-menu-label">{t(PRESET_LABEL[p])}</span>
                <span className="track-menu-meta">{formatWhenShort(snoozeAt(p, new Date()).toISOString(), locale)}</span>
              </button>
            ))}
            <div className="track-menu-sep" />
            <form
              className="track-menu-date"
              onSubmit={(e) => {
                e.preventDefault();
                const at = new Date(custom);
                if (!Number.isFinite(at.getTime())) return;
                close();
                void save(at);
              }}
            >
              <label htmlFor={`reminder-${issueId}`}>{t('reminder.custom')}</label>
              <input
                id={`reminder-${issueId}`}
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                required
              />
              <button type="submit" className="btn btn-sm">
                {t('reminder.set')}
              </button>
            </form>
            {reminder && (
              <>
                <div className="track-menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="track-menu-item"
                  onClick={() => {
                    close();
                    void save(null);
                  }}
                >
                  <span className="track-menu-label">{t('reminder.clear')}</span>
                </button>
              </>
            )}
            <p className="track-menu-date">{t('reminder.help')}</p>
          </>
        )}
      </Popover>
      <span className="sr-only" role="status">
        {error ?? ''}
      </span>
      {error && (
        <span className="ui-error track-reminder-error" aria-hidden>
          {error}
        </span>
      )}
    </>
  );
}
