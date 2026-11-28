'use client';

import { useEffect, useState } from 'react';
import { TRACK_RELEASES_CHANGED } from './trackEvents';

/** Lo que los selectores necesitan de un release (lib/track-releases). */
export interface ReleaseOption {
  id: string;
  name: string;
  version: string;
  status: 'planned' | 'in_progress' | 'released';
  project_id: string;
  team_name: string;
}

// Una sola carga por página para todos los que la piden (sidebar del issue, ⌘K, filtros).
let cache: Promise<ReleaseOption[]> | null = null;

function load(): Promise<ReleaseOption[]> {
  if (!cache) {
    cache = fetch('/api/track/releases?options=1')
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: ReleaseOption[] }>) : { rows: [] }))
      .then((d) => d.rows)
      .catch(() => {
        cache = null;
        return [];
      });
  }
  return cache;
}

/** Avisa que los releases cambiaron (crear, renombrar, borrar): los selectores se recargan. */
export function releasesChanged() {
  cache = null;
  window.dispatchEvent(new Event(TRACK_RELEASES_CHANGED));
}

/** Nombre visible: "Mobile 2.1" (nombre y versión). */
export function releaseLabel(r: { name: string; version?: string | null }): string {
  return [r.name, r.version].filter(Boolean).join(' ');
}

/** Releases de los teams que la persona ve (el servidor ya filtra privados e invitados). */
export function useReleases(enabled = true): ReleaseOption[] {
  const [rows, setRows] = useState<ReleaseOption[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const run = () => void load().then((r) => alive && setRows(r));
    run();
    // Releases de otros (un compañero creó uno): se vuelven a pedir al volver a la pestaña.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      cache = null;
      run();
    };
    window.addEventListener(TRACK_RELEASES_CHANGED, run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.removeEventListener(TRACK_RELEASES_CHANGED, run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
  return rows;
}
