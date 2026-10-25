'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import AdvancedSection from '@/components/ui/AdvancedSection';
import type { CalendarBlockedSlotRow } from '@/lib/db';
import CalIcon from './cal-icons';
import { parseDbUtc } from '@/lib/utils';

function toIso(local: string): string {
  return local ? new Date(local).toISOString() : '';
}

/**
 * Bloqueos de la persona (vacaciones, un trámite): tapan los horarios de todos
 * sus eventos. Van plegados en Disponibilidad, como las excepciones por fecha,
 * con cuántos hay a la derecha. Primero la lista (o el vacío), después el alta.
 */
export default function BlockedSlotsPanel({ initialSlots }: { initialSlots: CalendarBlockedSlotRow[] }) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const id = useId();
  const [slots, setSlots] = useState<CalendarBlockedSlotRow[]>(initialSlots);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const range = (s: CalendarBlockedSlotRow) => `${fmt.format(parseDbUtc(s.starts_at))} – ${fmt.format(parseDbUtc(s.ends_at))}`;

  async function addSlot(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!startsAt || !endsAt) return setError(t('blockedSlots.missing'));
    // Un bloqueo con el fin antes del inicio no bloquea nada.
    if (new Date(endsAt) <= new Date(startsAt)) return setError(t('errors.invalid_range'));
    setBusy(true);
    setError(null);
    const res = await fetch('/api/calendar/blocked-slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startsAt: toIso(startsAt), endsAt: toIso(endsAt), reason: reason.trim() || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      const slot = (await res.json()) as CalendarBlockedSlotRow;
      setSlots((prev) => [slot, ...prev]);
      setStartsAt('');
      setEndsAt('');
      setReason('');
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  async function removeSlot(slotId: string) {
    const res = await fetch(`/api/calendar/blocked-slots/${slotId}`, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) {
      setSlots((prev) => prev.filter((s) => s.id !== slotId));
      setError(null);
    } else {
      setError(t('errors.generic'));
    }
  }

  return (
    <AdvancedSection
      storageKey="cal.blocked"
      className="cal-blocked"
      label={t('blockedSlots.title')}
      hint={t('blockedSlots.count', { n: slots.length })}
    >
      <p className="ui-help">
        {t('blockedSlots.lead')} {t('blockedSlots.note')}
      </p>
      {slots.length === 0 ? (
        <p className="cal-muted">{t('blockedSlots.empty')}</p>
      ) : (
        <ul className="cal-block-list">
          {slots.map((s) => (
            <li key={s.id}>
              <span className="data">{range(s)}</span>
              <span className="cal-muted">{s.reason}</span>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => removeSlot(s.id)}
                aria-label={t('blockedSlots.remove', { range: range(s) })}
                title={t('common.remove')}
              >
                <CalIcon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="cal-block-add" onSubmit={addSlot} noValidate>
        <div className="cal-block-form">
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-from`}>
              {t('blockedSlots.from')}
            </label>
            <input id={`${id}-from`} className="input data" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-to`}>
              {t('blockedSlots.to')}
            </label>
            <input
              id={`${id}-to`}
              className="input data"
              type="datetime-local"
              min={startsAt || undefined}
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-reason`}>
              {t('blockedSlots.reason')} <span className="ui-optional">{t('editor.optional')}</span>
            </label>
            <input id={`${id}-reason`} className="input" value={reason} placeholder={t('blockedSlots.reasonPlaceholder')} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button type="submit" className="btn btn-sm" aria-busy={busy || undefined}>
            <CalIcon name="plus" />
            {t('blockedSlots.add')}
          </button>
        </div>
      </form>
    </AdvancedSection>
  );
}
