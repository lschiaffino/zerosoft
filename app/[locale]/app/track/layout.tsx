import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import TrackShortcuts from '@/components/track/TrackShortcuts';
import TrackBranch from '@/components/track/TrackBranch';
import '@/styles/track.css';
import '@/styles/track-quick.css';
import '@/styles/track-triage.css';

/** Layout de Track: atajos globales (C, J/K, Enter), quick-create en contexto y los proyectos en el sidebar. */
export default async function TrackLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['track', 'trackTriage']}>
      {props.children}
      <Suspense fallback={null}>
        <TrackShortcuts />
      </Suspense>
      <TrackBranch />
    </ClientMessages>
  );
}
