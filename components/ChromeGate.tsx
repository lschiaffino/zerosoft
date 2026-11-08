'use client';

import { useTranslations } from 'next-intl';
import { useSelectedLayoutSegments } from 'next/navigation';
import { usePathname } from '@/i18n/navigation';
import type { ReactNode } from 'react';
import { SURFACE_PREFIX } from '@/lib/host-rewrite';

/** Primer segmento de las rutas a las que el middleware reescribe un host (superficies y sitios de Docs). */
const REWRITE_TARGETS = new Set<string>([...Object.values(SURFACE_PREFIX), 'h']);

/**
 * Separa el chrome del sitio (header/footer de marketing) del chrome de las
 * apps. Bajo /app no se renderiza ni header ni footer de marketing: la app
 * tiene su propio chrome (sidebar) en app/[locale]/app/layout.tsx. Las páginas
 * públicas de reserva (/book, /r) son del cliente del usuario: van limpias, con
 * solo un "Powered by" discreto (y así se pueden embeber en un iframe).
 *
 * El board público (feedback.zerosoft.ai o /feedback-board) y la página de
 * marca (branding.zerosoft.ai o /brand, y las exploraciones de
 * /nuevo-branding) tienen su propio chrome mínimo: acá
 * no se pone el de marketing ni el launcher de feedback.
 *
 * El middleware reescribe esos hosts (feedback.zerosoft.ai → /feedback-board,
 * branding.zerosoft.ai → /brand, el dominio propio de un sitio de Docs →
 * /h/<handle>): el navegador ve otro path que el servidor. Para esas rutas se
 * decide con la ruta real (los segmentos del árbol, iguales en servidor y
 * cliente) y no con el host: así el layout no lee la request y el sitio puede
 * ser estático.
 */
export default function ChromeGate({
  header,
  footer,
  support = null,
  launcher = null,
  children,
}: {
  header: ReactNode;
  footer: ReactNode;
  /** Widget de soporte propio: en el sitio y en la app, nunca en páginas públicas de clientes. */
  support?: ReactNode;
  /** Launcher de feedback (ideas, enviar, novedades): en el sitio y en la app. */
  launcher?: ReactNode;
  children: ReactNode;
}) {
  const browserPath = usePathname();
  const segments = useSelectedLayoutSegments().filter((s) => !s.startsWith('(') && !s.startsWith('__'));
  const pathname = segments.length && REWRITE_TARGETS.has(segments[0]) ? `/${segments.join('/')}` : browserPath;
  const t = useTranslations('common.publicPage');
  if (
    pathname.startsWith('/feedback-board') ||
    pathname === '/brand' ||
    pathname.startsWith('/brand/') ||
    pathname.startsWith('/nuevo-branding/') ||
    // Pantallas de permisos de OAuth: nada más que la decisión, sin links que la distraigan.
    pathname.startsWith('/oauth/')
  ) {
    return <>{children}</>;
  }
  if (pathname.startsWith('/app')) {
    return (
      <>
        {children}
        {support}
        {launcher}
      </>
    );
  }
  const publicPage =
    pathname.startsWith('/book/') ||
    // Insight o tablero compartido: se puede embeber, sin el marco del sitio.
    pathname.startsWith('/stats/a/') ||
    pathname.startsWith('/r/') ||
    pathname.startsWith('/bio/') ||
    // Notas y pizarras compartidas por link (Notes /n, Board /b).
    pathname.startsWith('/n/') ||
    pathname.startsWith('/b/') ||
    // Diseños de Design compartidos por link (/d/<token>).
    pathname.startsWith('/d/') ||
    pathname.startsWith('/a/') ||
    // Quotes del CRM (/q/<token>): documento del cliente, sin chrome de marketing.
    pathname.startsWith('/q/') ||
    // Facturas de Books (/invoice/<token>): documento del cliente, sin chrome de marketing.
    pathname.startsWith('/invoice/') ||
    // Firma de Sign (/sign/<token>): el destinatario firma sin cuenta, sin chrome de marketing.
    pathname.startsWith('/sign/') ||
    // Link de Send (/send/<token>): quien lo abre ve el documento, sin chrome de marketing.
    pathname.startsWith('/send/') ||
    // Formularios del CRM (/f/<slug|token>): página del cliente, también embebida en un iframe.
    pathname.startsWith('/f/') ||
    // Formularios hospedados de Flow (/flow/form/<token>): página sola del cliente.
    pathname.startsWith('/flow/form/') ||
    // Documentos y videos compartidos desde el CRM (/view/<token>, /watch/<token>).
    pathname.startsWith('/view/') ||
    pathname.startsWith('/watch/') ||
    // Videos de Rec compartidos por link y su reproductor para insertar (/v/<id>, /v/<id>/embed).
    pathname.startsWith('/v/') ||
    // Centro de ayuda público de un workspace (/h/<handle>): página del cliente.
    pathname.startsWith('/h/') ||
    // /@handle se reescribe a /bio/<handle>, pero el navegador ve /@handle.
    /^\/@/.test(pathname) ||
    (typeof window !== 'undefined' && window.location.pathname.startsWith('/@'));
  if (publicPage) {
    return (
      <>
        {children}
        <p className="powered-by">
          <a href="https://zerosoft.ai" target="_blank" rel="noreferrer">
            {t('poweredBy')}
          </a>
        </p>
      </>
    );
  }
  return (
    <>
      {header}
      {children}
      {footer}
      {support}
      {launcher}
    </>
  );
}
