import type { ReactNode } from 'react';
import TzDependent from '@/components/app/TzDependent';

/** Analytics de Link: los días del gráfico van en la zona horaria de quien mira. */
export default function TzLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <TzDependent />
    </>
  );
}
