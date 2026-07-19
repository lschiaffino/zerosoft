'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CalendarBlockedSlotRow } from '@/lib/db';

interface BlockedSlotsPanelProps {
  initialSlots: CalendarBlockedSlotRow[];
}

function formatLocalInput(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function toIso(local: string): string {
  if (!local) return '';
  return new Date(local).toISOString();
}

export default function BlockedSlotsPanel({ initialSlots }: BlockedSlotsPanelProps) {
  const t = useTranslations('calendar');
  const [slots, setSlots] = useState<CalendarBlockedSlotRow[]>(initialSlots);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function addSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!startsAt || !endsAt) return;
    setBusy(true);
    const res = await fetch('/api/calendar/blocked-slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
        reason: reason || undefined,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      const slot = (await res.json()) as CalendarBlockedSlotRow;
      setSlots((prev) => [slot, ...prev]);
      setStartsAt('');
      setEndsAt('');
      setReason('');
    }
  }

  async function removeSlot(id: string) {
    const res = await fetch(`/api/calendar/blocked-slots/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) {
      setSlots((prev) => prev.filter((s) => s.id !== id));
    }
  }

  return (
    <section className="panel">
      <p className="section-label">{t('blockedSlots.title')}</p>
      <form className="blocked-form" onSubmit={addSlot}>
        <input
          className="input"
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          required
        />
        <input
          className="input"
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          required
        />
        <input
          className="input"
          placeholder={t('blockedSlots.reasonPlaceholder')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button type="submit" className="btn btn-solid btn-small" disabled={busy}>
          {t('blockedSlots.add')}
        </button>
      </form>

      {slots.length === 0 ? (
        <p className="muted">{t('blockedSlots.empty')}</p>
      ) : (
        <ul className="blocked-list">
          {slots.map((s) => (
            <li key={s.id} className="blocked-row">
              <span className="mono">
                {formatLocalInput(s.starts_at)} → {formatLocalInput(s.ends_at)}
              </span>
              {s.reason && <span className="muted">{s.reason}</span>}
              <button type="button" className="btn btn-ghost btn-small" onClick={() => removeSlot(s.id)}>
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
