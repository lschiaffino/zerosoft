import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Reserva pública de Cal: solo los textos de reserva. */
export default async function BookingLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['calendar.booking', 'calendar.editor', 'calendar.errors', 'calendar.location', 'calendar.manage']}>
      {props.children}
    </ClientMessages>
  );
}
