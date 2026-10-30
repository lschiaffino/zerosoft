'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import PdfPages from './PdfPages';
import AdoptSignature, { initialsOf, type SignatureKind } from './AdoptSignature';
import { api, SignDialog, useErrorText } from './ui';

export interface PublicViewDto {
  state: 'ready' | 'otp' | 'done' | 'waiting' | 'completed' | 'declined' | 'voided' | 'expired';
  title: string;
  message: string;
  senderName: string;
  senderEmail: string;
  recipient: { name: string; email: string; role: 'signer' | 'approver' | 'cc'; maskedEmail: string };
  expiresAt: string | null;
  pages: Array<{ w: number; h: number }>;
  fields: Array<{ id: string; kind: string; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string; options: string[] }>;
}

/**
 * Firma pública (sin cuenta): código por email, consentimiento, el PDF con
 * los campos de este destinatario (solo los suyos), guía al campo siguiente,
 * firma escrita, dibujada o subida, terminar o rechazar con motivo.
 */
export default function SigningRoom({ token, initial }: { token: string; initial: PublicViewDto }) {
  const t = useTranslations('sign.public');
  const tf = useTranslations('sign.fields');
  const locale = useLocale();
  const errorText = useErrorText();
  const [view, setView] = useState(initial);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [stamped, setStamped] = useState<Set<string>>(new Set());
  const [signature, setSignature] = useState<{ image: string; how: SignatureKind } | null>(null);
  const [initials, setInitials] = useState<string>('');
  const [adopt, setAdopt] = useState<{ kind: 'signature' | 'initials'; fieldId: string } | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState('');
  const refs = useRef(new Map<string, HTMLElement>());
  const base = `/api/sign/public/${token}`;
  const isApprover = view.recipient.role === 'approver';

  const reload = useCallback(async () => {
    const r = await api<PublicViewDto>(base);
    if (r.ok) setView(r.data);
  }, [base]);

  const today = useMemo(() => new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }), [locale]);
  const filled = (f: PublicViewDto['fields'][number]) => {
    if (f.kind === 'signature' || f.kind === 'initials') return stamped.has(f.id);
    if (f.kind === 'date' || f.kind === 'name' || f.kind === 'email') return true;
    if (f.kind === 'checkbox') return values[f.id] === true;
    return typeof values[f.id] === 'string' && (values[f.id] as string).trim() !== '';
  };
  const pending = view.fields.filter((f) => f.required && !filled(f));
  const ordered = [...view.fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);

  const goNext = () => {
    const next = ordered.find((f) => f.required && !filled(f)) ?? ordered.find((f) => !filled(f));
    const el = next ? refs.current.get(next.id) : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
    }
  };

  const stamp = (f: PublicViewDto['fields'][number]) => {
    if (!consent) return setError(t('consentFirst'));
    setError('');
    if (f.kind === 'signature') {
      if (signature) setStamped((s) => new Set(s).add(f.id));
      else setAdopt({ kind: 'signature', fieldId: f.id });
    } else if (initials) setStamped((s) => new Set(s).add(f.id));
    else setAdopt({ kind: 'initials', fieldId: f.id });
  };

  const sendCode = async () => {
    setBusy(true);
    setError('');
    const r = await api<{ to: string }>(`${base}/otp`, { method: 'POST', json: { action: 'send' } });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data.error));
    setCodeSent(r.data.to);
  };
  const verify = async () => {
    setBusy(true);
    setError('');
    const r = await api(`${base}/otp`, { method: 'POST', json: { action: 'verify', code: code.trim() } });
    setBusy(false);
    if (!r.ok) {
      const left = (r.data as { left?: number }).left;
      return setError(left !== undefined ? `${errorText(r.data.error)} ${t('attemptsLeft', { n: left })}` : errorText(r.data.error));
    }
    await reload();
  };
  const finish = async () => {
    if (!consent) return setError(t('consentFirst'));
    if (pending.length) {
      setError(t('missing', { n: pending.length }));
      return goNext();
    }
    setBusy(true);
    setError('');
    const payload: Record<string, string | boolean> = {};
    for (const f of view.fields) {
      if (f.kind === 'signature' || f.kind === 'initials') {
        if (stamped.has(f.id)) payload[f.id] = 'signed';
      } else if (f.kind === 'checkbox') payload[f.id] = values[f.id] === true;
      else if (f.kind === 'text' || f.kind === 'dropdown') {
        if (typeof values[f.id] === 'string' && (values[f.id] as string).trim()) payload[f.id] = values[f.id] as string;
      }
    }
    const r = await api<{ state: string }>(`${base}/submit`, {
      method: 'POST',
      json: { action: 'sign', consent, values: payload, signature: signature?.image ?? null, signatureKind: signature?.how ?? null, initials: initials || null },
    });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data.error));
    setView((v) => ({ ...v, state: r.data.state === 'completed' ? 'completed' : 'done', fields: [], pages: [] }));
  };
  const decline = async () => {
    setBusy(true);
    const r = await api(`${base}/submit`, { method: 'POST', json: { action: 'decline', reason: reason.trim() } });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data.error));
    setDeclineOpen(false);
    setView((v) => ({ ...v, state: 'declined', fields: [], pages: [] }));
  };

  const header = (
    <header className="sgp-head">
      <p className="sgp-eyebrow">{t('eyebrow')}</p>
      <h1 className="sgp-title">{view.title}</h1>
      <p className="sgp-meta">{t('from', { name: view.senderName, email: view.senderEmail })}</p>
    </header>
  );

  if (view.state !== 'ready' && view.state !== 'otp') {
    return (
      <main className="sgp">
        {header}
        <section className="sgp-card" role="status">
          <h2 className="sgp-card-title">{t(`state.${view.state}.title`)}</h2>
          <p>{t(`state.${view.state}.body`)}</p>
        </section>
        <p className="sgp-legal">{t('legal')}</p>
      </main>
    );
  }

  if (view.state === 'otp') {
    return (
      <main className="sgp">
        {header}
        <section className="sgp-card">
          <h2 className="sgp-card-title">{t('otp.title')}</h2>
          <p>{t('otp.body', { name: view.recipient.name, email: view.recipient.maskedEmail })}</p>
          {!codeSent ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void sendCode()}>
              {t('otp.send')}
            </button>
          ) : (
            <form
              className="ui-fields"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <p className="ui-help">{t('otp.sent', { email: codeSent })}</p>
              <label className="ui-field">
                <span className="label">{t('otp.code')}</span>
                <input className="input sgp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
              </label>
              <div className="sg-row">
                <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
                  {t('otp.verify')}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void sendCode()}>
                  {t('otp.resend')}
                </button>
              </div>
            </form>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <p className="sgp-legal">{t('legal')}</p>
      </main>
    );
  }

  return (
    <main className="sgp sgp-ready">
      {header}
      {view.message && <p className="sgp-message">{view.message}</p>}
      <section className="sgp-card">
        <label className="ui-check sgp-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{t('consent')}</span>
        </label>
        <p className="ui-help">{t('consentHelp')}</p>
      </section>

      <div className="sgp-bar" role="region" aria-label={t('progress')}>
        <span className="num" aria-live="polite">
          {isApprover && view.fields.length === 0 ? t('approveHint') : t('remaining', { n: pending.length })}
        </span>
        <span className="sg-row">
          {view.fields.length > 0 && (
            <button type="button" className="btn btn-sm btn-outline" onClick={goNext}>
              {t('next')}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void finish()}>
            {isApprover ? t('approve') : t('finish')}
          </button>
        </span>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <PdfPages
        src={`${base}/document`}
        pages={view.pages}
        label={view.title}
        overlay={(page) =>
          view.fields
            .filter((f) => f.page === page)
            .map((f) => {
              const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` };
              const setRef = (el: HTMLElement | null) => {
                if (el) refs.current.set(f.id, el);
                else refs.current.delete(f.id);
              };
              const label = f.label || tf(`kind.${f.kind}`);
              const cls = `sgp-field${f.required && !filled(f) ? ' is-needed' : ''}`;
              if (f.kind === 'signature' || f.kind === 'initials') {
                const img = f.kind === 'signature' ? signature?.image : initials;
                return (
                  <button key={f.id} ref={setRef} type="button" className={`${cls} sgp-stamp`} style={style} data-field={f.kind} aria-label={stamped.has(f.id) ? t('signedField', { kind: label }) : t('signHere', { kind: label })} onClick={() => stamp(f)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {stamped.has(f.id) && img ? <img src={img} alt="" /> : <span>{f.kind === 'signature' ? t('signHereShort') : t('initialHereShort')}</span>}
                  </button>
                );
              }
              if (f.kind === 'checkbox') {
                return (
                  <span key={f.id} className={`${cls} sgp-check`} style={style}>
                    <input ref={setRef} type="checkbox" aria-label={label} checked={values[f.id] === true} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.checked }))} />
                  </span>
                );
              }
              if (f.kind === 'dropdown') {
                return (
                  <select key={f.id} ref={setRef} className={`${cls} sgp-input`} style={style} aria-label={label} value={(values[f.id] as string) ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}>
                    <option value="">{label}</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                );
              }
              if (f.kind === 'text') {
                return <input key={f.id} ref={setRef} className={`${cls} sgp-input`} style={style} aria-label={label} placeholder={label} maxLength={500} value={(values[f.id] as string) ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} />;
              }
              const auto = f.kind === 'date' ? today : f.kind === 'name' ? view.recipient.name : view.recipient.email;
              return (
                <span key={f.id} ref={setRef} tabIndex={-1} className="sgp-field sgp-auto" style={style} title={t('autoField')}>
                  {auto}
                </span>
              );
            })
        }
      />

      <div className="sgp-foot">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void finish()}>
          {isApprover ? t('approve') : t('finish')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setDeclineOpen(true)}>
          {t('decline')}
        </button>
      </div>
      <p className="sgp-legal">{t('legal')}</p>

      <AdoptSignature
        open={adopt !== null}
        kind={adopt?.kind ?? 'signature'}
        defaultText={adopt?.kind === 'initials' ? initialsOf(view.recipient.name) : view.recipient.name}
        onClose={() => setAdopt(null)}
        onAdopt={(image, how) => {
          if (!adopt) return;
          if (adopt.kind === 'signature') setSignature({ image, how });
          else setInitials(image);
          setStamped((s) => new Set(s).add(adopt.fieldId));
          setAdopt(null);
        }}
      />

      <SignDialog open={declineOpen} title={t('declineTitle')} onClose={() => setDeclineOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) void decline();
          }}
        >
          <div className="ui-modal-body ui-fields">
            <p>{t('declineBody')}</p>
            <label className="ui-field">
              <span className="label">{t('declineReason')}</span>
              <textarea className="textarea" rows={3} required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </label>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setDeclineOpen(false)}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy || !reason.trim()}>
              {t('declineConfirm')}
            </button>
          </div>
        </form>
      </SignDialog>
    </main>
  );
}
