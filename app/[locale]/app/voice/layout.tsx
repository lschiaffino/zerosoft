import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import AppTour from '@/components/tour/AppTour';
import '@/styles/voice.css';

/** Voice: su hoja de estilos y los textos de sus componentes cliente. */
export default async function VoiceLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['voice']}>
      {props.children}
      {/* Tour guiado de Voice (lib/tours/voice.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="voice" />
      </Suspense>
    </ClientMessages>
  );
}
