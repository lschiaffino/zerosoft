'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { desktopBridge } from '@/lib/desktop-bridge';
import { nativeLoginAvailable, startNativeLogin } from '@/lib/native-login';

/**
 * Login con Google. Dentro de la app de escritorio o la móvil Google no se
 * abre en la webview (lo bloquea): se abre en el navegador del sistema y
 * vuelve sola (desktop/src/main/auth.ts, lib/native-login.ts).
 */
export default function GoogleButton({
  label,
  locale,
  callbackUrl,
  desktopHint,
}: {
  label: string;
  locale: string;
  callbackUrl?: string;
  desktopHint?: string;
}) {
  const [waiting, setWaiting] = useState(false);
  function onClick() {
    const desktop = desktopBridge();
    if (desktop) {
      desktop.startLogin();
      setWaiting(true);
      return;
    }
    if (nativeLoginAvailable()) {
      setWaiting(true);
      void startNativeLogin(locale, () => setWaiting(false));
      return;
    }
    void signIn('google', { callbackUrl: callbackUrl ?? `/${locale}/app` });
  }
  return (
    <>
      <button className="btn-google" onClick={onClick}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
            fill="currentColor"
            opacity="0.9"
          />
          <path
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
            fill="currentColor"
            opacity="0.7"
          />
          <path d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" fill="currentColor" opacity="0.5" />
          <path
            d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
            fill="currentColor"
            opacity="0.85"
          />
        </svg>
        {label}
      </button>
      {waiting && desktopHint ? (
        <p className="auth-sub" role="status">
          {desktopHint}
        </p>
      ) : null}
    </>
  );
}
