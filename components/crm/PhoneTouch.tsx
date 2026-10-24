'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { isDefaultOutcome, telHref, whatsappHref, type CallChannel } from '@/lib/crm-calls';
import CrmIcon from './CrmIcon';
import PlaybookLauncher from './PlaybookLauncher';

interface PhoneTouchProps {
  phone: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  /** En tablas: íconos discretos que aparecen al pasar el mouse. */
  compact?: boolean;
}

interface ChannelOutcomes {
  call: string[];
  whatsapp: string[];
}

/** Cache por página de los resultados del workspace por canal (GET /api/crm/settings). */
let outcomesPromise: Promise<ChannelOutcomes> | null = null;
function loadOutcomes(): Promise<ChannelOutcomes> {
  if (!outcomesPromise) {
    outcomesPromise = fetch('/api/crm/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { callOutcomes?: string[]; whatsappOutcomes?: string[] } | null) => ({
        call: d?.callOutcomes ?? [],
        whatsapp: d?.whatsappOutcomes ?? [],
      }))
      .catch(() => {
        outcomesPromise = null;
        return { call: [], whatsapp: [] };
      });
  }
  return outcomesPromise;
}

/**
 * Atajos de llamada y WhatsApp de un teléfono. El link abre la app de
 * siempre y además ofrece registrar el toque en el timeline con su resultado.
 */
export default function PhoneTouch({ phone, contactId, companyId, dealId, compact = false }: PhoneTouchProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const tel = telHref(phone);
  const wa = whatsappHref(phone);
  const [channel, setChannel] = useState<CallChannel | null>(null);
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (channel === null) return;
    void loadOutcomes().then((all) => setOutcomes(channel === 'whatsapp' ? all.whatsapp : all.call));
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setChannel(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setChannel(null);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [channel]);

  if (!tel && !wa) return null;

  const outcomeLabel = (o: string) => (isDefaultOutcome(o) ? t(`calls.outcomes.${o}`) : o);

  function open(next: CallChannel) {
    if (next !== channel) setOutcomes([]);
    setOutcome('');
    setNote('');
    setMinutes('');
    setSaved(false);
    setError(false);
    setChannel(next);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (channel === null || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch('/api/crm/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'call',
        channel,
        direction: 'outbound',
        subject: channel === 'whatsapp' ? t('calls.subjectWhatsapp') : t('calls.subjectCall'),
        body: note.trim() || undefined,
        outcome: outcome || undefined,
        durationMin: channel === '' && minutes ? Math.max(0, Math.round(Number(minutes) || 0)) : undefined,
        contactId: contactId ?? undefined,
        companyId: companyId ?? undefined,
        dealId: dealId ?? undefined,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return;
    }
    setSaved(true);
    setChannel(null);
    router.refresh();
  }

  return (
    <span className={`phone-touch${compact ? ' is-compact' : ''}`} ref={ref}>
      {tel && (
        <a
          href={tel}
          className={compact ? 'cell-quick' : 'phone-touch-btn'}
          title={t('calls.call')}
          aria-label={t('calls.call')}
          onClick={() => open('')}
        >
          <CrmIcon name="phone" />
          {!compact && <span>{t('calls.call')}</span>}
        </a>
      )}
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className={compact ? 'cell-quick' : 'phone-touch-btn'}
          title={t('calls.whatsapp')}
          aria-label={t('calls.whatsapp')}
          onClick={() => open('whatsapp')}
        >
          <CrmIcon name="message" />
          {!compact && <span>{t('calls.whatsapp')}</span>}
        </a>
      )}
      {saved && !compact && (
        <span className="muted phone-touch-saved" role="status">
          {t('calls.logged')}
        </span>
      )}
      {channel !== null && (
        <form className="phone-log" onSubmit={save} aria-label={t('calls.logTitle')}>
          <p className="phone-log-title">{channel === 'whatsapp' ? t('calls.logWhatsapp') : t('calls.logCall')}</p>
          <div className="phone-log-outcomes" role="radiogroup" aria-label={t('calls.outcome')}>
            {outcomes.map((o) => (
              <label key={o} className="ui-check">
                <input type="radio" name="call-outcome" checked={outcome === o} onChange={() => setOutcome(o)} /> {outcomeLabel(o)}
              </label>
            ))}
          </div>
          {channel === '' && (
            <label className="phone-log-field">
              <span>{t('calls.minutes')}</span>
              <input className="input" type="number" min={0} step={1} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </label>
          )}
          <textarea
            className="textarea"
            rows={2}
            maxLength={5000}
            placeholder={t('calls.notePlaceholder')}
            aria-label={t('calls.note')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="form-error">{t('errors.generic')}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-solid btn-small" disabled={busy}>
              {t('calls.save')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setChannel(null)}>
              {t('calls.skip')}
            </button>
            {/* Guion de llamada: el playbook se guarda como esta llamada, con sus respuestas. */}
            {(contactId || dealId || companyId) && (
              <PlaybookLauncher
                compact
                entity={contactId ? 'contact' : dealId ? 'deal' : 'company'}
                entityId={(contactId ?? dealId ?? companyId)!}
                call={{
                  outcome: outcome || undefined,
                  durationMin: channel === '' && minutes ? Math.max(0, Math.round(Number(minutes) || 0)) : undefined,
                  note: note.trim() || undefined,
                  channel,
                }}
                onSaved={() => {
                  setSaved(true);
                  setChannel(null);
                }}
              />
            )}
          </div>
        </form>
      )}
    </span>
  );
}
