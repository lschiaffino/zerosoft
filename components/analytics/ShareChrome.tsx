'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

const REFRESH_MS = 30 * 60_000;

/** Lo que un link público hace por su cuenta: tema, actualizarse cada 30 minutos y avisar su alto al embeberse. */
export default function ShareChrome({ theme, embed }: { theme: 'system' | 'light' | 'dark'; embed: boolean }) {
  const router = useRouter();
  const last = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    const before = root.getAttribute('data-theme');
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    return () => {
      if (before) root.setAttribute('data-theme', before);
      else root.removeAttribute('data-theme');
    };
  }, [theme]);

  useEffect(() => {
    last.current = Date.now();
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last.current < REFRESH_MS) return;
      last.current = Date.now();
      router.refresh();
    };
    const iv = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', check);
    };
  }, [router]);

  useEffect(() => {
    if (!embed || window.parent === window) return;
    const send = () => window.parent.postMessage({ event: 'zs:dimensions', name: window.name, height: document.documentElement.scrollHeight }, '*');
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [embed]);

  return null;
}

/** Pedido de contraseña de un link público protegido. */
export function ShareUnlock({ token }: { token: string }) {
  const t = useTranslations('analytics.share');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/analytics/share-unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password }) });
      if (res.ok) {
        // Embebido en otro sitio, el navegador puede no guardar el acceso: se avisa en lugar de volver a pedirla.
        const kept = (await (await fetch(`/api/analytics/share-unlock?token=${encodeURIComponent(token)}`)).json()) as { ok: boolean };
        if (kept.ok) {
          router.refresh();
          return;
        }
        setBlocked(true);
        return;
      }
      setError(res.status === 429 ? t('tooManyTries') : t('wrongPassword'));
    } catch {
      setError(t('wrongPassword'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="an-share-unlock an-panel" onSubmit={(e) => void submit(e)}>
      <h1 className="an-h3 an-flush">{t('passwordTitle')}</h1>
      <label className="ui-field">
        <span className="label">{t('passwordLabel')}</span>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input className="input" type="password" autoComplete="off" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {blocked && (
        <p className="an-note" role="status" data-testid="an-share-blocked">
          {t('cookiesBlocked')}{' '}
          <a href={window.location.pathname} target="_blank" rel="noopener noreferrer" className="an-link">
            {t('openNewTab')}
          </a>
        </p>
      )}
      <button type="submit" className="btn btn-primary an-self-start" disabled={busy || !password} aria-busy={busy}>
        {t('passwordEnter')}
      </button>
    </form>
  );
}
