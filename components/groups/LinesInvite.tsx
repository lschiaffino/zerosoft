'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import CopyButton from '@/components/link/CopyButton';

interface Outcome {
  email: string;
  status: 'sent' | 'failed' | 'skipped' | 'member' | 'invalid' | 'limited';
  url?: string;
}

/**
 * Invitar gente a Lines: entra al workspace como member y solo con Lines (el
 * servidor lo fuerza: /api/teams/invites). Lo ven con el botón activo los
 * admins y los members con "Puede invitar a Lines"; el resto lo ve apagado,
 * con el motivo.
 */
export default function LinesInvite({ allowed, locale }: { allowed: boolean; locale: string }) {
  const t = useTranslations('groups.invite');
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>): Promise<{ results: Outcome[]; invalid?: string[] } | null> {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/teams/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'member', apps: ['groups'], locale, ...body }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.status === 403 ? t('forbidden') : res?.status === 429 ? t('limited') : res?.status === 400 ? t('invalidEmails') : t('failed'));
      return null;
    }
    return (await res.json()) as { results: Outcome[]; invalid?: string[] };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!emails.trim() || busy || !allowed) return;
    const data = await post({ emails });
    if (!data) return;
    setResults(data.results);
    if (data.invalid?.length) setError(t('invalidList', { list: data.invalid.join(', ') }));
    setEmails('');
  }

  async function onLink() {
    if (busy || !allowed) return;
    const data = await post({ link: true });
    if (data) setResults(data.results);
  }

  return (
    <div className="ui-fields gr-invite" data-testid="lines-invite">
      <p className="ui-help">{t('intro')}</p>
      <form className="ws-invite" onSubmit={onSubmit}>
        <div className="ui-field">
          <label className="label" htmlFor="lines-invite-emails">
            {t('emails')}
          </label>
          <textarea
            id="lines-invite-emails"
            className="input ws-invite-emails"
            rows={3}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder={t('placeholder')}
            disabled={!allowed}
            aria-describedby={allowed ? undefined : 'lines-invite-locked'}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="st-form-foot ws-invite-foot">
          <button type="submit" className="btn btn-primary" style={{ minHeight: 40 }} disabled={!allowed || !emails.trim() || busy} aria-describedby={allowed ? undefined : 'lines-invite-locked'} data-testid="lines-invite-send">
            {t('send')}
          </button>
          <button type="button" className="btn btn-secondary" style={{ minHeight: 40 }} onClick={() => void onLink()} disabled={!allowed || busy} aria-describedby={allowed ? undefined : 'lines-invite-locked'} data-testid="lines-invite-link">
            {t('link')}
          </button>
        </div>
        {!allowed && (
          <p id="lines-invite-locked" className="ui-help" data-testid="lines-invite-locked">
            {t('locked')}
          </p>
        )}
      </form>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {results && (
        <div className="ws-results" role="status" aria-live="polite">
          {results.map((r, i) => (
            <div key={`${r.email}-${i}`} className={`ws-result ws-result-${r.status}`} data-testid="lines-invite-result">
              <span className="data ws-result-email">{r.email || t('linkLabel')}</span>
              <span className="ws-result-status">{t(`result.${r.email ? r.status : 'link'}`)}</span>
              {r.url && r.status !== 'sent' && <CopyButton text={r.url} label={t('copy')} className="btn btn-secondary btn-sm" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
