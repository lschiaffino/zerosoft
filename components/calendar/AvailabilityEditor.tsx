'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CalendarAvailabilityRow } from '@/lib/db';

interface Rule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface AvailabilityEditorProps {
  eventTypeId: string;
  initialRules: CalendarAvailabilityRow[];
}

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function emptyRule(day = 1): Rule {
  return { dayOfWeek: day, startTime: '09:00', endTime: '17:00' };
}

function parseRules(rows: CalendarAvailabilityRow[]): Rule[] {
  return rows.map((r) => ({
    dayOfWeek: r.day_of_week,
    startTime: r.start_time,
    endTime: r.end_time,
  }));
}

export default function AvailabilityEditor({ eventTypeId, initialRules }: AvailabilityEditorProps) {
  const t = useTranslations('calendar');
  const [rules, setRules] = useState<Rule[]>(parseRules(initialRules));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function addRule(day?: number) {
    setRules((prev) => [...prev, emptyRule(day ?? 1)]);
    setSaved(false);
  }

  function updateRule(index: number, patch: Partial<Rule>) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSaved(false);
  }

  function removeRule(index: number) {
    setRules((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    const res = await fetch(`/api/calendar/event-types/${eventTypeId}/availability`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) setSaved(true);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <p className="section-label">{t('availability.title')}</p>
        <div className="panel-actions">
          <button type="button" className="btn btn-small" onClick={() => addRule()}>
            {t('availability.addRule')}
          </button>
          <button type="button" className="btn btn-solid btn-small" onClick={save} disabled={busy}>
            {busy ? t('common.saving') : saved ? t('common.saved') : t('common.save')}
          </button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="empty-inline">
          <p className="muted">{t('availability.empty')}</p>
          <button type="button" className="btn btn-small" onClick={() => addRule()}>
            {t('availability.addRule')}
          </button>
        </div>
      ) : (
        <div className="availability-rules">
          {rules.map((rule, i) => (
            <div key={i} className="availability-row">
              <select
                className="select"
                value={rule.dayOfWeek}
                onChange={(e) => updateRule(i, { dayOfWeek: Number(e.target.value) })}
              >
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {t(`availability.day.${d}`)}
                  </option>
                ))}
              </select>
              <input
                className="input mono"
                type="time"
                value={rule.startTime}
                onChange={(e) => updateRule(i, { startTime: e.target.value })}
              />
              <span className="muted">→</span>
              <input
                className="input mono"
                type="time"
                value={rule.endTime}
                onChange={(e) => updateRule(i, { endTime: e.target.value })}
              />
              <button type="button" className="btn btn-ghost btn-small" onClick={() => removeRule(i)}>
                {t('common.remove')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
