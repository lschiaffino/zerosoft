'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void };
  }
}

/** Widget de Cloudflare Turnstile (o, en tests, un checkbox que da el token de prueba). */
export function Captcha({ siteKey, label, onToken }: { siteKey: string; label: string; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (siteKey === 'fake') return;
    const el = ref.current;
    if (!el) return;
    let widget: string | null = null;
    const render = () => {
      if (!window.turnstile || widget !== null) return;
      widget = window.turnstile.render(el, {
        sitekey: siteKey,
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(''),
      });
    };
    if (window.turnstile) render();
    else {
      const id = 'cf-turnstile-script';
      let script = document.getElementById(id) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = id;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', render);
    }
  }, [siteKey, onToken]);
  if (siteKey === 'fake') {
    return (
      <div className="fp-field fp-check" data-testid="form-captcha">
        <label htmlFor="fp-captcha">
          <input id="fp-captcha" type="checkbox" onChange={(e) => onToken(e.target.checked ? 'fake-pass' : '')} />
          <span>{label}</span>
        </label>
      </div>
    );
  }
  return <div ref={ref} className="fp-captcha" data-testid="form-captcha" />;
}
