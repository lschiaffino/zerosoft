'use client';

import { useEffect } from 'react';
import { installListMemory } from './trackNav';

/**
 * Recuerda el orden de la lista al abrir un issue (para "4 / 12" y J/K en el
 * issue) y marca el body mientras se está en Track (en el teléfono el botón
 * flotante de feedback no tapa la columna de asignados, como en Linear).
 */
export default function TrackListMemory() {
  useEffect(() => {
    document.body.dataset.inTrack = '1';
    const off = installListMemory();
    return () => {
      off();
      delete document.body.dataset.inTrack;
    };
  }, []);
  return null;
}
