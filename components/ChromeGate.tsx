'use client';

import { usePathname } from '@/i18n/navigation';
import type { ReactNode } from 'react';

/**
 * Separa el chrome del sitio (header/footer de marketing) del chrome de las
 * apps. Bajo /app no se renderiza ni header ni footer de marketing: la app
 * tiene su propio chrome (sidebar) en app/[locale]/app/layout.tsx.
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
  return (
    <>
      {header}
      {children}
      {footer}
    </>
  );
}
