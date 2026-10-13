import { Suspense, type ReactNode } from 'react';
import TrackShortcuts from '@/components/track/TrackShortcuts';

/** Layout de Track: atajos globales (C, J/K, Enter) y quick-create en contexto. */
export default function TrackLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <TrackShortcuts />
      </Suspense>
    </>
  );
}
