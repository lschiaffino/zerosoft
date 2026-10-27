/**
 * Cal — píxeles de seguimiento de las páginas públicas (Google Analytics 4 y
 * Meta Pixel) y la marca "Powered by". Puro: lo usan el server (validar y
 * guardar) y las páginas públicas (armar los scripts).
 *
 * Eventos que se mandan, igual que Calendly:
 * - al ver la página: page_view (GA4) y PageView (Meta);
 * - al elegir un horario: cal_date_and_time_selected (GA4);
 * - al reservar: cal_event_scheduled (GA4) y Schedule (Meta).
 */

export const GA4_ID = /^G-[A-Z0-9]{4,20}$/i;
export const META_PIXEL_ID = /^\d{5,20}$/;

export interface CalTracking {
  ga4?: string;
  metaPixel?: string;
}

/** JSON guardado → ids válidos (los rotos o vacíos se descartan). */
export function parseTracking(json: string | null | undefined): CalTracking {
  let raw: unknown;
  try {
    raw = JSON.parse(json || '{}');
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: CalTracking = {};
  if (typeof r.ga4 === 'string' && GA4_ID.test(r.ga4.trim())) out.ga4 = r.ga4.trim().toUpperCase();
  if (typeof r.metaPixel === 'string' && META_PIXEL_ID.test(r.metaPixel.trim())) out.metaPixel = r.metaPixel.trim();
  return out;
}

/**
 * Antes de cargar un píxel, la URL que ven Google y Meta queda solo con los
 * utm_*: el email, el nombre, las respuestas, rsid o host del link nunca
 * salen a un tercero (la página ya los leyó en el server). Devuelve la URL limpia.
 */
const CLEAN_URL =
  "var __zsU=(function(){try{var u=new URL(location.href),k=[];u.searchParams.forEach(function(v,n){if(!/^utm_/.test(n))k.push(n)});" +
  "k.forEach(function(n){u.searchParams.delete(n)});var c=u.origin+u.pathname+(u.searchParams.toString()?'?'+u.searchParams.toString():'');" +
  "if(c!==location.href)history.replaceState(history.state,'',c);return c}catch(e){return location.origin+location.pathname}})();";

/** Script inline de GA4 (gtag) para un id ya validado. */
export function ga4Snippet(id: string): string {
  if (!GA4_ID.test(id)) return '';
  return `${CLEAN_URL}window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}',{page_location:__zsU});`;
}

/** Script inline de Meta Pixel para un id ya validado. */
export function metaPixelSnippet(id: string): string {
  if (!META_PIXEL_ID.test(id)) return '';
  return (
    CLEAN_URL +
    "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};" +
    "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;" +
    "s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');" +
    `fbq('init','${id}');fbq('track','PageView');`
  );
}

type TrackWindow = Window & { gtag?: (...args: unknown[]) => void; fbq?: (...args: unknown[]) => void };

/** Manda un evento del embudo de reserva a los píxeles que haya en la página (navegador). */
export function trackCalEvent(name: 'date_selected' | 'scheduled', data: Record<string, string | number> = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as TrackWindow;
  try {
    if (typeof w.gtag === 'function') {
      w.gtag('event', name === 'scheduled' ? 'cal_event_scheduled' : 'cal_date_and_time_selected', data);
    }
    if (name === 'scheduled' && typeof w.fbq === 'function') w.fbq('track', 'Schedule', data);
  } catch {
    // Un píxel roto nunca corta la reserva.
  }
  // El embed avisa a la página que lo contiene (como el postMessage de Calendly).
  try {
    if (window.parent !== window) {
      window.parent.postMessage({ event: name === 'scheduled' ? 'zerosoft.event_scheduled' : 'zerosoft.date_and_time_selected', payload: data }, '*');
    }
  } catch {
    // Sin parent accesible: no pasa nada.
  }
}
