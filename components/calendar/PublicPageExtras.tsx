import Script from 'next/script';
import { getCalendarUser } from '@/lib/calendar';
import { ga4Snippet, metaPixelSnippet, parseTracking } from '@/lib/calendar-tracking';

/**
 * Lo que agrega el workspace a sus páginas públicas de Cal (reserva, perfil,
 * gestión y routing forms): sin "Powered by" si lo sacó (la marca escondida
 * se detecta con :has() en styles/calendar.css, porque el pie lo pinta
 * ChromeGate) y los píxeles de Google Analytics 4 y Meta Pixel.
 * `pixels: false` en la gestión de la reserva: esa página es una credencial.
 */
export default async function PublicPageExtras({ workspaceId, pixels = true }: { workspaceId: string; pixels?: boolean }) {
  const config = await getCalendarUser(workspaceId);
  if (!config) return null;
  const tracking = pixels ? parseTracking(config.tracking) : {};
  return (
    <>
      {config.hide_branding === 1 && <span className="cal-hide-powered" hidden />}
      {tracking.ga4 && (
        <>
          <Script id="cal-ga4-src" src={`https://www.googletagmanager.com/gtag/js?id=${tracking.ga4}`} strategy="afterInteractive" />
          <Script id="cal-ga4" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: ga4Snippet(tracking.ga4) }} />
        </>
      )}
      {tracking.metaPixel && (
        <Script id="cal-meta-pixel" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: metaPixelSnippet(tracking.metaPixel) }} />
      )}
    </>
  );
}
