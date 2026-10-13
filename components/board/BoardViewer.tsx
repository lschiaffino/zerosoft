'use client';

import dynamic from 'next/dynamic';
import type { BoardScene } from '@/lib/boards-types';

const ExcalidrawCanvas = dynamic(() => import('./ExcalidrawCanvas'), {
  ssr: false,
  loading: () => <div className="board-loading" aria-busy="true" />,
});

/** Pizarra pública de solo lectura (/b/<token>). */
export default function BoardViewer({ scene, locale }: { scene: BoardScene; locale: string }) {
  return (
    <div className="board-canvas">
      <ExcalidrawCanvas scene={scene} locale={locale} viewMode />
    </div>
  );
}
