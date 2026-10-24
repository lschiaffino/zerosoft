/** Utilidades compartidas por los componentes de IA del CRM (cliente). */

const KNOWN = new Set([
  'ai_disabled',
  'quota_exceeded',
  'rate_limited',
  'not_found',
  'no_content',
  'closed_deal',
  'no_targets',
  'not_ready',
  'invalid_input',
  'missing_required',
  'unsubscribed',
  'send_failed',
  'missing_recipient',
  'missing_email',
  'no_website',
  'site_unreachable',
  'site_empty',
]);

/**
 * Clave de crm.ai.errors.* para un código de error de la API. Sin IA, los
 * admins ven la pista de configuración (la variable de entorno); el resto no.
 */
export function aiErrorKey(code: string | null | undefined, admin = false): `errors.${string}` {
  if (code === 'ai_disabled' && admin) return 'errors.ai_disabled_admin';
  return `errors.${code && KNOWN.has(code) ? code : 'generic'}`;
}

export function formatAiWhen(iso: string, locale: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/** YYYY-MM-DD a `days` días de hoy (fecha local). */
export function dayFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
