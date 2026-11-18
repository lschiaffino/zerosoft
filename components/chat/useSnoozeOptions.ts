'use client';

import { useEffect, useState } from 'react';

export interface SnoozeOption {
  id: string;
  label: string;
  minutes: number;
  team_id: string | null;
}

/** Opciones propias de posponer del workspace: se suman a las fijas de la bandeja. */
export function useSnoozeOptions(): SnoozeOption[] {
  const [options, setOptions] = useState<SnoozeOption[]>([]);
  useEffect(() => {
    let alive = true;
    void fetch('/api/chat/snooze-options')
      .then((r) => (r.ok ? (r.json() as Promise<{ options: SnoozeOption[] }>) : null))
      .then((d) => {
        if (alive && d) setOptions(d.options);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return options;
}
