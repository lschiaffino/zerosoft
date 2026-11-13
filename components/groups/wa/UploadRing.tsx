'use client';

import { useSyncExternalStore } from 'react';
import { uploadProgress } from '@/lib/optimistic-send';

const R = 15;
const C = 2 * Math.PI * R;

/**
 * El avance de la subida de un archivo que se está mandando (como WhatsApp):
 * sobre una foto o un video, un anillo fino centrado; en una nota de voz o un
 * documento, una línea fina abajo, que no tapa el reproductor. Con varios (un
 * álbum), el promedio. Sin avance conocido todavía, gira (o la línea corre).
 */
export default function UploadRing({ ids, label, overlay }: { ids: string[]; label: string; /** Sobre una foto o un video (anillo); si no, la línea. */ overlay: boolean }) {
  const value = useSyncExternalStore(
    uploadProgress.subscribe,
    () => {
      const known = ids.map((id) => uploadProgress.get(id)).filter((p): p is number => typeof p === 'number');
      return known.length ? Math.round((known.reduce((a, b) => a + b, 0) / ids.length) * 100) : -1;
    },
    () => -1,
  );
  const pct = value < 0 ? null : value;
  const a11y = { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct ?? undefined } as const;
  if (!overlay) {
    return (
      <span className={`wa-upbar${pct === null ? ' is-spinning' : ''}`} {...a11y}>
        <i style={pct === null ? undefined : { width: `${Math.max(3, pct)}%` }} />
      </span>
    );
  }
  return (
    <span className={`wa-upring${pct === null ? ' is-spinning' : ''}`} {...a11y}>
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="wa-upring-track" cx="18" cy="18" r={R} />
        <circle className="wa-upring-bar" cx="18" cy="18" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - (pct ?? 25) / 100)} />
      </svg>
    </span>
  );
}
