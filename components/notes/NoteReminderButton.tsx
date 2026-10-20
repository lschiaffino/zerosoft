'use client';

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import NotesIcon from './NotesIcon';
import { usePopover } from './usePopover';
import { reminderPresets, toLocalInputValue } from './notes-ui';

type Reminder = { at: string; sent_at: string | null } | null;

/**
 * Recordatorio de la nota: botón con la fecha (si hay) y popover para elegir
 * día y hora, con atajos. Al vencer llega una notificación in-app y un email
 * (lib/notes-reminders.ts, desde el cron de cada minuto).
 */
export default function NoteReminderButton({
  noteId,
  reminder,
  onChange,
  onError,
}: {
  noteId: string;
  reminder: Reminder;
  onChange: (reminder: Reminder) => void;
  onError?: () => void;
}) {
  const t = useTranslations('notes.reminder');
  const format = useFormatter();
  const locale = useLocale();
  const pop = usePopover();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = reminder && !reminder.sent_at;
  const label = reminder
    ? format.dateTime(new Date(reminder.at), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  function open() {
    setError(null);
    setDraft(reminder ? toLocalInputValue(new Date(reminder.at)) : '');
    pop.toggle();
  }

  async function save(at: Date) {
    if (!Number.isFinite(at.getTime())) {
      setError(t('invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}/reminder`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          at: at.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale,
        }),
      });
      const data = (await res.json().catch(() => null)) as { reminder?: Reminder; error?: string } | null;
      if (!res.ok) {
        setError(data?.error === 'reminder_in_past' ? t('inPast') : t('invalid'));
        return;
      }
      onChange(data?.reminder ?? null);
      pop.close(true);
    } catch {
      onError?.();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${noteId}/reminder`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      onChange(null);
      pop.close(true);
    } catch {
      onError?.();
    } finally {
      setBusy(false);
    }
  }

  const presets = reminderPresets(new Date());

  return (
    <div className="note-share-wrap" ref={pop.wrapRef}>
      <button
        ref={pop.buttonRef}
        type="button"
        className={`btn btn-ghost btn-sm${pending ? ' is-on' : ''}`}
        onClick={open}
        aria-expanded={pop.open}
        aria-haspopup="dialog"
        aria-label={label ? t('buttonSet', { date: label }) : t('button')}
        title={label ? t('buttonSet', { date: label }) : t('button')}
      >
        <NotesIcon name="bell" size={14} />
        {label && <span className={`note-bar-label note-reminder-date${reminder?.sent_at ? ' is-done' : ''}`}>{label}</span>}
      </button>
      {pop.open && (
        <div className="notes-pop" role="dialog" aria-label={t('title')}>
          <p className="notes-pop-title">{t('title')}</p>
          <p className="notes-pop-hint">{t('hint')}</p>
          <div className="note-reminder-presets">
            {presets.map((p) => (
              <button key={p.key} type="button" className="btn btn-sm" disabled={busy} onClick={() => void save(p.at)}>
                {t(`presets.${p.key}`)}
              </button>
            ))}
          </div>
          <form
            className="notes-pop-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft) void save(new Date(draft));
            }}
          >
            <input
              className="input"
              type="datetime-local"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={t('custom')}
              required
            />
            <button type="submit" className="btn btn-sm btn-primary" aria-busy={busy} disabled={!draft}>
              {t('save')}
            </button>
          </form>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          {reminder && (
            <button type="button" className="btn btn-sm btn-ghost btn-danger notes-pop-off" disabled={busy} onClick={() => void clear()}>
              {t('remove')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
