'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import type { ReactNode } from 'react';
import type { HostSurface } from '@/lib/host-rewrite';

/**
 * Separa el chrome del sitio (header/footer de marketing) del chrome de las
 * apps. Bajo /app no se renderiza ni header ni footer de marketing: la app
 * tiene su propio chrome (sidebar) en app/[locale]/app/layout.tsx. Las páginas
 * públicas de reserva (/book, /r) son del cliente del usuario: van limpias, con
 * solo un "Powered by" discreto (y así se pueden embeber en un iframe).
 *
 * El board público (feedback.zerosoft.ai o /feedback-board) y la página de
 * marca (branding.zerosoft.ai o /brand, y las guías de temas en
 * /nuevo-branding/<tema>) tienen su propio chrome mínimo: acá
 * no se pone el de marketing ni el launcher de feedback. `surface` viene del
 * host (el layout lo resuelve en el servidor), así server y cliente coinciden
 * aunque el middleware haya reescrito el path.
 */
export default function ChromeGate({
  header,
  footer,
  support = null,
  launcher = null,
  surface = null,
  children,
}: {
  header: ReactNode;
  footer: ReactNode;
  /** Widget de soporte propio: en el sitio y en la app, nunca en páginas públicas de clientes. */
  support?: ReactNode;
  /** Launcher de feedback (ideas, enviar, novedades): en el sitio y en la app. */
  launcher?: ReactNode;
  /** Superficie del host (board, brand) o null para el sitio normal. */
  surface?: HostSurface | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslations('common.publicPage');
  if (
    surface ||
    pathname.startsWith('/feedback-board') ||
    pathname === '/brand' ||
    pathname.startsWith('/brand/') ||
    pathname.startsWith('/nuevo-branding/')
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
    pathname.startsWith('/r/') ||
    pathname.startsWith('/bio/') ||
    // Notas y pizarras compartidas por link (Notes /n, Board /b).
    pathname.startsWith('/n/') ||
    pathname.startsWith('/b/') ||
    pathname.startsWith('/a/') ||
    // Quotes del CRM (/q/<token>): documento del cliente, sin chrome de marketing.
    pathname.startsWith('/q/') ||
    // Formularios del CRM (/f/<slug|token>): página del cliente, también embebida en un iframe.
    pathname.startsWith('/f/') ||
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
