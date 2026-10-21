import { Suspense, type ReactNode } from 'react';
import TrackShortcuts from '@/components/track/TrackShortcuts';
import TrackBranch from '@/components/track/TrackBranch';

/** Layout de Track: atajos globales (C, J/K, Enter), quick-create en contexto y los proyectos en el sidebar. */
export default function TrackLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <TrackShortcuts />
      </Suspense>
      <TrackBranch />
    </>
  );
}
