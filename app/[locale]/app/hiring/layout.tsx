import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import AppTour from '@/components/tour/AppTour';
import { requireUser } from '@/lib/session';
import '@/styles/hiring.css';

/** Hiring: puestos, pipeline, candidatos, scorecards, entrevistas y ofertas. */
export default async function HiringLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['hiring']}>
      {props.children}
      {/* Tour guiado de Hiring (lib/tours/hiring.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="hiring" />
      </Suspense>
    </ClientMessages>
  );
}
