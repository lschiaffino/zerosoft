/**
 * Login con Google dentro de la app móvil (mobile/, Capacitor). Google no
 * deja entrar desde una webview, así que se usa el mismo flujo que el
 * escritorio (lib/desktop-auth.ts): el navegador del sistema (Safari View
 * Controller / Custom Tabs, plugin Browser) abre /api/desktop/login con un
 * challenge PKCE, vuelve por zerosoft://auth/callback (plugin App) y la página
 * canjea el código en /api/desktop/token con setCookie: la cookie httpOnly la
 * pone el servidor, el token nunca pasa por JS. Cliente.
 */

interface CapacitorLike {
  isNativePlatform?: () => boolean;
  Plugins?: {
    Browser?: { open: (o: { url: string }) => Promise<void>; close?: () => Promise<void> };
    App?: { addListener: (event: 'appUrlOpen', cb: (data: { url: string }) => void) => Promise<{ remove: () => void }> | { remove: () => void } };
  };
}

function capacitor(): CapacitorLike | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: CapacitorLike }).Capacitor;
  return cap?.isNativePlatform?.() ? cap : null;
}

export function nativeLoginAvailable(): boolean {
  const cap = capacitor();
  return !!cap?.Plugins?.Browser && !!cap.Plugins.App;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Datos del deep link de vuelta, o null si no es el nuestro. */
export function parseAuthCallback(raw: string): { code: string; state: string } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'zerosoft:' || url.hostname !== 'auth' || url.pathname.replace(/\/+$/, '') !== '/callback') return null;
    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    return /^[A-Za-z0-9_-]{32,128}$/.test(code) && /^[A-Za-z0-9_-]{16,128}$/.test(state) ? { code, state } : null;
  } catch {
    return null;
  }
}

export async function startNativeLogin(locale: string, onError: () => void): Promise<void> {
  const cap = capacitor();
  const Browser = cap?.Plugins?.Browser;
  const App = cap?.Plugins?.App;
  if (!Browser || !App) return onError();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const handle = await App.addListener('appUrlOpen', async ({ url }) => {
    const back = parseAuthCallback(url);
    if (!back || back.state !== state) return;
    handle.remove();
    await Browser.close?.().catch(() => undefined);
    const res = await fetch('/api/desktop/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: back.code, verifier, setCookie: true }),
    }).catch(() => null);
    if (res?.ok) window.location.assign(`/${locale}/app`);
    else onError();
  });
  const params = new URLSearchParams({ challenge, state, locale });
  await Browser.open({ url: `${window.location.origin}/api/desktop/login?${params}` });
}
