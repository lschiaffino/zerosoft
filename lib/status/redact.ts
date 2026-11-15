/**
 * Limpieza de textos del monitoreo.
 *
 * - `redactSecrets`: para lo interno (email al dueño, API del watcher). Saca
 *   los valores de las variables secretas, tokens Bearer, apikey=… y JWT. Los
 *   hosts quedan: ayudan a diagnosticar y eso no sale de nosotros.
 * - `publicText`: para lo que el watcher o Claude marcan como público. Además
 *   saca URLs, hosts, IPs, emails y números largos (teléfonos, ids de cuenta).
 */

const SECRET_ENVS = [
  'GROUPS_BRIDGE_KEY',
  'INBOX_BRIDGE_KEY',
  'TURSO_AUTH_TOKEN',
  'RESEND_API_KEY',
  'STATUS_AGENT_TOKEN',
  'CRON_SECRET',
  'NEXTAUTH_SECRET',
];

const MAX = 1000;

export function redactSecrets(input: unknown, max = MAX): string {
  let s = typeof input === 'string' ? input : input instanceof Error ? input.message : String(input ?? '');
  for (const name of SECRET_ENVS) {
    const v = process.env[name]?.trim();
    if (v && v.length >= 6) s = s.split(v).join('[redacted]');
  }
  s = s
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1[redacted]')
    .replace(/((?:api[-_]?key|apikey|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"'&,}]{4,}/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted-jwt]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function publicText(input: string, max = 2000): string {
  return redactSecrets(input, max)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[link]')
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, '[email]')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '[ip]')
    // Hosts sueltos (algo.railway.app, db.internal…): dos o más etiquetas con un TLD de letras.
    .replace(/\b(?:[a-z0-9-]+\.)+(?:app|io|com|net|org|dev|ai|internal|local|cloud|sh|xyz|co)\b(:\d+)?/gi, (h) =>
      /^(status\.)?zerosoft\.ai$/i.test(h) ? h : '[host]',
    )
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]');
}
