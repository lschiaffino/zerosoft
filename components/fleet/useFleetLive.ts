'use client';

/**
 * Fleet en vivo: el feed de la persona por SSE (o polling corto) con lib/realtime-client.ts. Cada lote de eventos
 * llama a `onChange` (con un pequeño respiro para juntar ráfagas del hook); la pantalla vuelve a leer lo suyo.
 */
import { useEffect, useRef, useState } from 'react';
import { RealtimeClient, type RealtimeMode, type RealtimeStatus } from '@/lib/realtime-client';

export interface FleetFeedEvent {
  id: number;
  kind: 'session' | 'message' | 'items' | 'connections';
  ref: string;
}

export function useFleetLive(opts: { cursor: number; mode?: RealtimeMode; onChange: (events: FleetFeedEvent[]) => void }): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const onChange = useRef(opts.onChange);
  onChange.current = opts.onChange;
  useEffect(() => {
    let pending: FleetFeedEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const batch = pending;
      pending = [];
      onChange.current(batch);
    };
    const queue = (events: FleetFeedEvent[]) => {
      pending.push(...events);
      if (!timer) timer = setTimeout(flush, 250);
    };
    const client = new RealtimeClient<FleetFeedEvent>({
      streamUrl: '/api/fleet/stream',
      pollUrl: '/api/fleet/events',
      cursor: opts.cursor,
      mode: opts.mode,
      pollMs: 3000,
      hiddenPollMs: 30_000,
      resumeOnBye: true,
      onEvents: (events) => {
        if (events.length) queue(events);
      },
      onConnect: () => queue([]),
      onReset: () => queue([]),
      onStatus: setStatus,
    });
    client.start();
    return () => {
      if (timer) clearTimeout(timer);
      client.stop();
    };
    // El cursor inicial solo cuenta al montar: después lo lleva el cliente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.mode]);
  return status;
}
