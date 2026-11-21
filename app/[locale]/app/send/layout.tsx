import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import AppTour from '@/components/tour/AppTour';
import { requireUser } from '@/lib/session';
import '@/styles/send.css';

/** Send: documentos, links, espacios y quién leyó qué. */
export default async function SendLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['send']}>
      {props.children}
      {/* Tour guiado de Send (lib/tours/send.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="send" />
      </Suspense>
    </ClientMessages>
  );
}
