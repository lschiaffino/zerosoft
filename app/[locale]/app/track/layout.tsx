import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import TrackShortcuts from '@/components/track/TrackShortcuts';
import TrackBranch from '@/components/track/TrackBranch';
import TrackUndoToast from '@/components/track/TrackUndoToast';
import IssuePeek from '@/components/track/IssuePeek';
import TrackListMemory from '@/components/track/TrackListMemory';
import TrackIssueDnd from '@/components/track/TrackIssueDnd';
import AppTour from '@/components/tour/AppTour';
import '@/styles/track.css';
import '@/styles/track-quick.css';
import '@/styles/track-ux.css';
import '@/styles/track-planning.css';
import '@/styles/track-triage.css';
import '@/styles/track-editor.css';
import '@/styles/track-issue.css';
import '@/styles/track-forms.css';

/** Layout de Track: atajos globales (C, J/K, Enter), quick-create en contexto y los proyectos en el sidebar. */
export default async function TrackLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['track', 'trackPlanning', 'trackTriage', 'trackList']}>
      {props.children}
      <Suspense fallback={null}>
        <TrackShortcuts />
      </Suspense>
      <Suspense fallback={null}>
        <TrackBranch />
      </Suspense>
      <TrackUndoToast />
      <IssuePeek />
      <TrackListMemory />
      <TrackIssueDnd />
      {/* Tour guiado de Track (lib/tours/track.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="track" />
      </Suspense>
    </ClientMessages>
  );
}
