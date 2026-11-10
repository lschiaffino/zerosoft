'use client';

import { useEffect, useState } from 'react';
import { detectDesktopOs, downloadHref, inDesktopShell, type DesktopOs } from '@/lib/desktop-os';

interface Props {
  locale: string;
  labels: { title: string; body: string; mac: string; win: string; dismiss: string; dismissError: string };
}

/**
 * Tarjeta del inicio para quien usa zerosoft en el navegador y no instaló la
 * app de escritorio (el servidor ya filtró instalada y cerrada,
 * lib/desktop-hint.ts). Acá se esconde en el teléfono, Linux y dentro de la
 * app. Cerrarla la saca en todos sus dispositivos.
 */
export default function DesktopHomeCard({ locale, labels }: Props) {
  const [os, setOs] = useState<DesktopOs | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    if (inDesktopShell()) return;
    void detectDesktopOs().then((v) => {
      if (alive && v !== 'mobile' && v !== 'other') setOs(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!os || hidden) return null;

  const dismiss = async () => {
    setHidden(true);
    setError(false);
    const res = await fetch('/api/desktop/hint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dismiss: true }),
    }).catch(() => null);
    if (!res?.ok) {
      // No quedó guardado: vuelve, con el aviso, para que se pueda probar de nuevo.
      setHidden(false);
      setError(true);
    }
  };

  return (
    <div className="home-card home-card-desktop" data-testid="home-desktop">
      <div className="home-card-head">
        <h3 className="home-card-title">{labels.title}</h3>
        <button type="button" className="btn btn-ghost btn-icon btn-sm home-card-close" aria-label={labels.dismiss} title={labels.dismiss} onClick={() => void dismiss()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
      <p className="home-card-body">{labels.body}</p>
      {error && (
        <p className="ui-error" role="alert">
          {labels.dismissError}
        </p>
      )}
      <a className="btn btn-secondary btn-sm" href={downloadHref('in-app', { os, locale })} rel="nofollow">
        {os === 'win' ? labels.win : labels.mac}
      </a>
    </div>
  );
}
