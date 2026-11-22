import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import AppTour from '@/components/tour/AppTour';
import '@/styles/social.css';

/** Social: su hoja de estilos y los textos de sus componentes cliente. */
export default async function SocialLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['social']}>
      {props.children}
      {/* Tour guiado de Social (lib/tours/social.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="social" />
      </Suspense>
    </ClientMessages>
  );
}
