'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';

interface Preview {
  bookings: number;
  upcoming: number;
  submissions: number;
  votes: number;
  guestOf: number;
}

/**
 * Borrar los datos de un invitado por email (GDPR / LGPD): primero muestra
 * cuánto hay, después borra con confirmación explícita.
 */
export default function PrivacyPanel() {
  const t = useTranslations('calendar');
  const id = useId();
  const [email, setEmail] = useState('');
  const [preview, setPreview] = useState<{ email: string; data: Preview } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(confirm: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/calendar/privacy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: confirm && preview ? preview.email : email.trim(), confirm }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.status === 400 ? t('privacy.invalidEmail') : t('errors.generic'));
      return;
    }
    const data = (await res.json()) as { preview?: Preview; deleted?: Preview };
    if (confirm) {
      setDone(preview?.email ?? '');
      setPreview(null);
      setEmail('');
    } else if (data.preview) {
      setDone(null);
      setPreview({ email: email.trim(), data: data.preview });
    }
  }

  const total = preview ? preview.data.bookings + preview.data.submissions + preview.data.votes + preview.data.guestOf : 0;

  return (
    <FormSection
      title={t('privacy.title')}
      description={t('privacy.lead')}
      tone="danger"
      footer={
        <>
          <p className="ui-section-note" role="status" data-tone={error ? 'error' : done !== null ? 'ok' : undefined}>
            {error ?? (done !== null ? t('privacy.deleted', { email: done }) : t('privacy.note'))}
          </p>
          {preview && total > 0 ? (
            <button type="button" className="btn btn-danger" onClick={() => void call(true)} aria-busy={busy || undefined}>
              {t('privacy.confirm', { email: preview.email })}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void call(false)} aria-busy={busy || undefined} disabled={!email.trim()}>
              {t('privacy.search')}
            </button>
          )}
        </>
      }
    >
      <div className="ui-field">
        <label className="label" htmlFor={`${id}-email`}>
          {t('privacy.email')}
        </label>
        <input
          id={`${id}-email`}
          className="input"
          type="email"
          value={email}
          autoComplete="off"
          placeholder="name@example.com"
          onChange={(e) => {
            setEmail(e.target.value);
            setPreview(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (email.trim()) void call(false);
            }
          }}
        />
      </div>
      {preview && (
        <div className="cal-callout" role="status">
          {total === 0 ? (
            t('privacy.nothing', { email: preview.email })
          ) : (
            <>
              <p>{t('privacy.found', { email: preview.email })}</p>
              <ul className="cal-privacy-list">
                <li>{t('privacy.bookings', { n: preview.data.bookings, upcoming: preview.data.upcoming })}</li>
                <li>{t('privacy.guestOf', { n: preview.data.guestOf })}</li>
                <li>{t('privacy.submissions', { n: preview.data.submissions })}</li>
                <li>{t('privacy.votes', { n: preview.data.votes })}</li>
              </ul>
              <p>{t('privacy.irreversible')}</p>
            </>
          )}
        </div>
      )}
    </FormSection>
  );
}
