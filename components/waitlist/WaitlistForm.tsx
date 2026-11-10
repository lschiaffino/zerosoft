'use client';

import { useId, useState, type FormEvent } from 'react';

export interface WaitlistLabels {
  join: string;
  joining: string;
  /** Con {email} ya reemplazado o sin él (sitio). */
  joined: string;
  already: string;
  useCase: string;
  useCasePlaceholder: string;
  email: string;
  emailPlaceholder: string;
  invalidEmail: string;
  error: string;
  limited: string;
  privacy: string;
}

type State = 'idle' | 'busy' | 'joined' | 'already' | 'error' | 'invalid' | 'limited';

/**
 * "Unirme a la lista de espera" de una app "Próximamente" (POST /api/waitlist).
 * En la app (`signedIn`) es un clic con el email de la sesión; en el sitio pide
 * el email. "¿Para qué la usarías?" es opcional. Los textos llegan del servidor.
 */
export default function WaitlistForm({
  app,
  locale,
  signedIn,
  alreadyJoined = false,
  labels,
  compact = false,
}: {
  app: string;
  locale: string;
  signedIn: boolean;
  alreadyJoined?: boolean;
  labels: WaitlistLabels;
  /** Sin el campo "para qué" a la vista (se abre con un clic). */
  compact?: boolean;
}) {
  const id = useId();
  const [state, setState] = useState<State>(alreadyJoined ? 'already' : 'idle');
  const [email, setEmail] = useState('');
  const [useCase, setUseCase] = useState('');
  const [website, setWebsite] = useState('');
  const [showUseCase, setShowUseCase] = useState(!compact);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state === 'busy') return;
    if (!signedIn && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setState('invalid');
      return;
    }
    setState('busy');
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app, useCase, locale, website, ...(signedIn ? {} : { email: email.trim() }) }),
    }).catch(() => null);
    if (res?.status === 429) return setState('limited');
    if (res?.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return setState(data.error === 'invalid_email' ? 'invalid' : 'error');
    }
    if (!res?.ok) return setState('error');
    const data = (await res.json().catch(() => ({}))) as { created?: boolean };
    setState(data.created === false && signedIn ? 'already' : 'joined');
  }

  if (state === 'joined' || state === 'already') {
    return (
      <p className="wait-done" role="status" data-testid="waitlist-joined">
        {state === 'joined' ? labels.joined : labels.already}
      </p>
    );
  }

  return (
    <form className="wait-form" onSubmit={(e) => void submit(e)} noValidate data-testid="waitlist-form">
      {!signedIn && (
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-email`}>
            {labels.email}
          </label>
          <input
            id={`${id}-email`}
            className="input"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            maxLength={254}
            value={email}
            placeholder={labels.emailPlaceholder}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === 'invalid') setState('idle');
            }}
            aria-invalid={state === 'invalid' || undefined}
            aria-describedby={state === 'invalid' ? `${id}-err` : undefined}
          />
        </div>
      )}
      {showUseCase ? (
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-use`}>
            {labels.useCase}
          </label>
          <textarea
            id={`${id}-use`}
            className="textarea"
            rows={2}
            maxLength={500}
            value={useCase}
            placeholder={labels.useCasePlaceholder}
            onChange={(e) => setUseCase(e.target.value)}
          />
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm wait-more" onClick={() => setShowUseCase(true)}>
          {labels.useCase}
        </button>
      )}
      {/* Honeypot: invisible para personas. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="wait-hp"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      <div className="wait-actions">
        <button type="submit" className="btn btn-primary" disabled={state === 'busy'} aria-busy={state === 'busy' || undefined} data-testid="waitlist-join">
          {state === 'busy' ? labels.joining : labels.join}
        </button>
        <span className="wait-privacy">{labels.privacy}</span>
      </div>
      {(state === 'error' || state === 'invalid' || state === 'limited') && (
        <p className="ui-error" role="alert" id={`${id}-err`}>
          {state === 'invalid' ? labels.invalidEmail : state === 'limited' ? labels.limited : labels.error}
        </p>
      )}
    </form>
  );
}
