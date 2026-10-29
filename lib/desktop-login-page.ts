/**
 * HTML de las pantallas del login de las apps (escritorio y móvil) que ve el
 * navegador del sistema (/api/desktop/login): confirmar la cuenta con el
 * dispositivo, la hora y un aviso, volver a la app y el link inválido. Una página chica sin JS (CSP estricta), con los colores
 * del sitio en claro y oscuro.
 */
import en from '@/messages/en/pages.json';
import es from '@/messages/es/pages.json';
import pt from '@/messages/pt/pages.json';

type Locale = 'en' | 'es' | 'pt';
type Strings = typeof en.desktopLogin;
const ALL: Record<Locale, Strings> = { en: en.desktopLogin, es: es.desktopLogin, pt: pt.desktopLogin };

/** Dispositivo que pidió el login (lo manda la app; solo cambia el texto). */
export type LoginDevice = keyof Strings['devices'];
const DEVICES: readonly LoginDevice[] = ['mac', 'windows', 'linux', 'ios', 'android'];

export function parseLoginDevice(raw: unknown): LoginDevice {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'darwin') return 'mac';
  if (v === 'win32') return 'windows';
  return (DEVICES as readonly string[]).includes(v) ? (v as LoginDevice) : 'unknown';
}

export function desktopLoginStrings(locale: string): Strings {
  return ALL[(['en', 'es', 'pt'].includes(locale) ? locale : 'en') as Locale];
}

export function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const DESKTOP_LOGIN_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function page(locale: string, title: string, body: string, head = ''): string {
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
${head}
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#0d0d0d;--muted:#6b6b6b;--line:#e6e6e6;--btn:#0d0d0d;--btn-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--fg:#f2f2f2;--muted:#9a9a9a;--line:#2a2a2a;--btn:#f2f2f2;--btn-fg:#0d0d0d}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{width:100%;max-width:400px;border:1px solid var(--line);border-radius:6px;padding:28px 24px}
h1{font-size:20px;line-height:1.3;margin:12px 0 8px;font-weight:600}
p{margin:0 0 16px;color:var(--muted)}
strong{color:var(--fg);font-weight:600;word-break:break-all}
.btn{display:inline-flex;align-items:center;justify-content:center;width:100%;height:40px;border:0;border-radius:4px;background:var(--btn);color:var(--btn-fg);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.btn:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}
.fine{font-size:13px;margin:16px 0 0}
p.fine{margin:-8px 0 12px}
.warn{color:var(--fg);border-left:3px solid #d97706;padding:8px 12px;background:rgba(217,119,6,.08);font-size:14px}
svg{display:block}
</style>
</head>
<body><main>
<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="4" fill="currentColor"/><path transform="translate(6.83 5) scale(0.9167)" d="M10 1A8.5 11 0 1 1 10 23A8.5 11 0 1 1 10 1ZM10 4.1A5.3 7.9 0 1 0 10 19.9A5.3 7.9 0 1 0 10 4.1Z" fill="var(--bg)" fill-rule="evenodd"/></svg>
${body}
</main></body>
</html>`;
}

export function confirmPage(locale: string, input: { email: string; challenge: string; state: string; device: LoginDevice; now?: Date }): string {
  const t = desktopLoginStrings(locale);
  const time = (input.now ?? new Date()).toISOString().slice(11, 16);
  return page(
    locale,
    t.title,
    `<h1>${escapeHtml(t.title)}</h1>
<p>${escapeHtml(t.confirm).replace('{device}', `<strong>${escapeHtml(t.devices[input.device])}</strong>`).replace('{email}', `<strong>${escapeHtml(input.email)}</strong>`)}</p>
<p class="fine">${escapeHtml(t.requested.replace('{time}', time))}</p>
<p class="warn" role="note">${escapeHtml(t.warning)}</p>
<form method="post" action="/api/desktop/login">
<input type="hidden" name="challenge" value="${escapeHtml(input.challenge)}">
<input type="hidden" name="state" value="${escapeHtml(input.state)}">
<input type="hidden" name="locale" value="${escapeHtml(locale)}">
<input type="hidden" name="device" value="${escapeHtml(input.device)}">
<button class="btn" type="submit" autofocus>${escapeHtml(t.continue)}</button>
</form>
<p class="fine">${escapeHtml(t.notYou)}</p>`,
  );
}

export function returnPage(locale: string, deepLink: string): string {
  const t = desktopLoginStrings(locale);
  const href = escapeHtml(deepLink);
  return page(
    locale,
    t.doneTitle,
    `<h1>${escapeHtml(t.doneTitle)}</h1>
<p>${escapeHtml(t.doneBody)}</p>
<a class="btn" href="${href}">${escapeHtml(t.open)}</a>
<p class="fine">${escapeHtml(t.close)}</p>`,
    `<meta http-equiv="refresh" content="0;url=${href}">`,
  );
}

export function invalidPage(locale: string): string {
  const t = desktopLoginStrings(locale);
  return page(locale, t.invalidTitle, `<h1>${escapeHtml(t.invalidTitle)}</h1><p>${escapeHtml(t.invalidBody)}</p>`);
}
