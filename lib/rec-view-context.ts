/**
 * De dónde y con qué se vio un video de Rec, a partir del request. Server-only.
 *
 * - Lugar: en Vercel, de los headers x-vercel-ip-country, -country-region y
 *   -city, que pone la plataforma (contextFromHeaders solo los lee con VERCEL
 *   definido: en otro hosting un cliente podría mandarlos inventados). En
 *   self-host, geoip-lite con la IP resuelta según los proxies de confianza.
 * - Dispositivo, navegador y sistema: del user agent, reducido a esos tres.
 * - Origen: el dominio que manda el reproductor (document.referrer, solo el host).
 *
 * La IP se usa en el momento y no se guarda; el user agent tampoco.
 */
import { contextFromHeaders } from './track';
import { cleanRefHost, type RecViewContext } from './rec-insights';

const clip = (s: string | null | undefined, n: number) => (s ?? '').trim().slice(0, n);

export function recViewContext(headers: Headers, trustedIp: string | null, ref: unknown): RecViewContext {
  // Fuera de Vercel, x-forwarded-for lo puede escribir el cliente: solo vale la IP que
  // resolvió clientIp() con los proxies de confianza (o ninguna).
  let h = headers;
  if (!process.env.VERCEL) {
    h = new Headers(headers);
    h.delete('x-forwarded-for');
  }
  const c = contextFromHeaders(h, trustedIp);
  const ua = !!headers.get('user-agent')?.trim();
  const country = /^[A-Z]{2}$/.test((c.country ?? '').toUpperCase()) ? (c.country as string).toUpperCase() : '';
  return {
    country,
    // Región y ciudad sin país no sirven (y sin país no hay con qué cruzarlas).
    region: country ? clip(c.region, 10) : '',
    city: country ? clip(c.city, 80) : '',
    device: !ua ? '' : c.device === 'mobile' || c.device === 'tablet' || c.device === 'desktop' ? c.device : '',
    browser: ua && c.browser && c.browser !== 'Other' ? clip(c.browser, 40) : '',
    os: ua && c.os && c.os !== 'Other' ? clip(c.os, 40) : '',
    referrer: cleanRefHost(ref),
  };
}
