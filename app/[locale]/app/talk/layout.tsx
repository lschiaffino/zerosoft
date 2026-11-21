import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import AppTour from '@/components/tour/AppTour';
import '@/styles/docs.css';
import '@/styles/talk.css';
import '@/styles/talk-parity.css';

export default async function TalkLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['talk', 'docs']}>
      {props.children}
      {/* Tour guiado de Talk (lib/tours/talk.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="talk" />
      </Suspense>
    </ClientMessages>
  );
}
