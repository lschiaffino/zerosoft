'use client';

import { usePathname } from '@/i18n/navigation';
import type { ReactNode } from 'react';

/**
 * Separa el chrome del sitio (header/footer de marketing) del chrome de las
 * apps. Bajo /app no se renderiza ni header ni footer de marketing: la app
 * tiene su propio chrome (sidebar) en app/[locale]/app/layout.tsx. Las páginas
 * públicas de reserva (/book, /r) son del cliente del usuario: van limpias, con
 * solo un "Powered by" discreto (y así se pueden embeber en un iframe).
 */
export default function ChromeGate({
  header,
  footer,
  children,
}: {
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (pathname.startsWith('/app')) return <>{children}</>;
  if (pathname.startsWith('/book/') || pathname.startsWith('/r/')) {
    return (
      <>
        {children}
        <p className="powered-by mono">
          <a href="https://zerosoft.ai" target="_blank" rel="noreferrer">
            Powered by zerosoft
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
    </>
  );
}
