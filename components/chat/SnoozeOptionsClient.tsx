'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ChatIcon from './icons';
import type { SnoozeOption } from './useSnoozeOptions';

const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
type Unit = keyof typeof UNITS;

/** Opciones propias de posponer. Las crea un admin, para todos o para un equipo; el resto las usa en la bandeja. */
export default function SnoozeOptionsClient({ canManage, teams }: { canManage: boolean; teams: Array<{ id: string; name: string }> }) {
  const t = useTranslations('chat.snoozeOptions');
  const tc = useTranslations('chat');
  const [options, setOptions] = useState<SnoozeOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('2');
  const [unit, setUnit] = useState<Unit>('days');
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/chat/snooze-options').catch(() => null);
    if (!res?.ok) return setFailed(true);
    setFailed(false);
    setOptions(((await res.json()) as { options: SnoozeOption[] }).options);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const minutes = Math.round(Number(amount) * UNITS[unit]);
    if (!label.trim() || !(minutes > 0)) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/chat/snooze-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, minutes, team_id: teamId || null }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error;
      setError(code === 'too_many' ? t('tooMany') : code === 'invalid_input' ? t('invalid') : tc('errors.generic'));
      return;
    }
    setLabel('');
    await load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/chat/snooze-options?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) return setError(tc('errors.generic'));
    await load();
  }

  const duration = (m: number) => (m % 1440 === 0 ? t('days', { n: m / 1440 }) : m % 60 === 0 ? t('hours', { n: m / 60 }) : t('minutes', { n: m }));

  return (
    <section className="chat-section chat-snooze-options" data-testid="chat-snooze-options">
      <h2 className="ui-section-title">{t('title')}</h2>
      <p className="ui-help">{t('help')}</p>
      {failed ? (
        <p className="ui-error" role="alert">
          {tc('errors.generic')}
        </p>
      ) : options === null ? (
        <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
      ) : options.length === 0 ? (
        <p className="ui-help" data-testid="chat-snooze-empty">
          {t('empty')}
        </p>
      ) : (
        <ul className="chat-snooze-list">
          {options.map((o) => (
            <li key={o.id} data-testid="chat-snooze-option">
              <span className="chat-snooze-label">{o.label}</span>
              <span className="muted data">{duration(o.minutes)}</span>
              <span className="muted">{o.team_id ? (teams.find((x) => x.id === o.team_id)?.name ?? t('team')) : t('everyone')}</span>
              {canManage && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => void remove(o.id)} aria-label={t('remove', { label: o.label })} title={t('remove', { label: o.label })}>
                  <ChatIcon name="trash" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form className="chat-snooze-form" onSubmit={(e) => void add(e)}>
          <div className="ui-field">
            <label className="label" htmlFor="chat-snooze-label">
              {t('label')}
            </label>
            <input id="chat-snooze-label" className="input" value={label} maxLength={60} placeholder={t('labelPlaceholder')} onChange={(e) => setLabel(e.target.value)} data-testid="chat-snooze-label" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="chat-snooze-amount">
              {t('amount')}
            </label>
            <div className="ui-input-group">
              <input id="chat-snooze-amount" className="input data" type="number" min={1} max={999} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="chat-snooze-amount" />
              <select className="select" aria-label={t('unit')} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                <option value="minutes">{t('unitMinutes')}</option>
                <option value="hours">{t('unitHours')}</option>
                <option value="days">{t('unitDays')}</option>
              </select>
            </div>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="chat-snooze-team">
              {t('forWho')}
            </label>
            <select id="chat-snooze-team" className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">{t('everyone')}</option>
              {teams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-secondary" disabled={busy || !label.trim() || !(Number(amount) > 0)} data-testid="chat-snooze-add">
            {t('add')}
          </button>
        </form>
      ) : (
        <p className="ui-help">{t('adminOnly')}</p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
