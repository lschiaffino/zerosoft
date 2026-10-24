import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Formulario de ruteo de Cal: los textos de ruteo y reserva. */
export default async function RoutingLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['calendar.booking', 'calendar.common', 'calendar.editor', 'calendar.errors', 'calendar.location', 'calendar.routing']}>
      {props.children}
    </ClientMessages>
  );
}
