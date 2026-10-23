import type { ReactNode } from 'react';
import TzDependent from '@/components/app/TzDependent';

/** Tareas del CRM: "hoy" y "vencidas" dependen de la zona horaria. */
export default function TzLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <TzDependent />
    </>
  );
}
