import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import RecBranch from '@/components/rec/RecBranch';
import RecScope from '@/components/rec/RecScope';
import AppTour from '@/components/tour/AppTour';
import { realUserId, requireUser } from '@/lib/session';
import '@/styles/rec.css';

/** Rec: biblioteca, grabador y detalle. Las carpetas cuelgan del sidebar del shell. */
export default async function RecLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['rec']}>
      <RecScope userId={realUserId(user)} ws={user.id} />
      {props.children}
      <RecBranch />
      {/* Tour guiado de Rec (lib/tours/rec.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="rec" />
      </Suspense>
    </ClientMessages>
  );
}
