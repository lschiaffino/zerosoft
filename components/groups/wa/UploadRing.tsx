'use client';

import { useSyncExternalStore } from 'react';
import { uploadProgress } from '@/lib/optimistic-send';

const R = 15;
const C = 2 * Math.PI * R;

/**
 * El avance de la subida de un archivo que se está mandando, como un anillo
 * fino sobre su burbuja (como WhatsApp). Con varios (un álbum), el promedio.
 * Sin avance conocido todavía, el anillo gira.
 */
export default function UploadRing({ ids, label, overlay }: { ids: string[]; label: string; /** Sobre una foto o un video (centrado, con fondo); si no, chico en la esquina. */ overlay: boolean }) {
  const value = useSyncExternalStore(
    uploadProgress.subscribe,
    () => {
      const known = ids.map((id) => uploadProgress.get(id)).filter((p): p is number => typeof p === 'number');
      return known.length ? Math.round((known.reduce((a, b) => a + b, 0) / ids.length) * 100) : -1;
    },
    () => -1,
  );
  const pct = value < 0 ? null : value;
  return (
    <span
      className={`wa-upring${overlay ? ' is-overlay' : ''}${pct === null ? ' is-spinning' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
    >
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="wa-upring-track" cx="18" cy="18" r={R} />
        <circle className="wa-upring-bar" cx="18" cy="18" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - (pct ?? 25) / 100)} />
      </svg>
    </span>
  );
}
