'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Para el loading.tsx de una app en una sola ruta ([[...zs]]): en su página
 * de analítica muestra las placas del tablero; en el resto, las de siempre.
 */
export default function LoadingSwitch({ analytics, fallback }: { analytics: ReactNode; fallback: ReactNode }) {
  const pathname = usePathname() ?? '';
  return <>{/\/analytics\/?$/.test(pathname) ? analytics : fallback}</>;
}
