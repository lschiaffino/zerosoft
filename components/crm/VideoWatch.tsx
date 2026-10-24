'use client';

import { useEffect, useRef } from 'react';

/**
 * Reproductor de un video 1:1 con seguimiento: abre la vista al primer play,
 * suma los segundos reproducidos y la posición máxima, y manda pings cada 5 s
 * (y uno al cerrar con sendBeacon).
 */
export default function VideoWatch({ token, src, type, title }: { token: string; src: string; type: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const trackUrl = `/api/crm/v/${encodeURIComponent(token)}/track`;
  const state = useRef({ viewId: '', opening: false, watched: 0, position: 0, duration: 0, last: 0 });

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const s = state.current;
    const body = () => JSON.stringify({ viewId: s.viewId, watched: Math.round(s.watched), position: s.position, duration: s.duration });
    const send = (beacon = false) => {
      if (!s.viewId) return;
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(trackUrl, new Blob([body()], { type: 'application/json' }));
      else void fetch(trackUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body(), keepalive: true }).catch(() => undefined);
    };
    const open = () => {
      if (s.viewId || s.opening) return;
      s.opening = true;
      void fetch(trackUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ duration: Number.isFinite(v.duration) ? v.duration : 0 }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { viewId?: string } | null) => {
          if (d?.viewId) s.viewId = d.viewId;
        })
        .catch(() => undefined)
        .finally(() => {
          s.opening = false;
        });
    };
    const onTime = () => {
      const now = v.currentTime;
      const delta = now - s.last;
      // Solo cuenta lo reproducido (no los saltos con la barra).
      if (!v.paused && delta > 0 && delta < 2) s.watched += delta;
      s.last = now;
      s.position = Math.max(s.position, now);
      if (Number.isFinite(v.duration)) s.duration = v.duration;
    };
    const onPlay = () => {
      s.last = v.currentTime;
      open();
    };
    const onEnded = () => {
      if (Number.isFinite(v.duration)) s.position = v.duration;
      send();
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', () => (s.last = v.currentTime));
    v.addEventListener('pause', () => send());
    v.addEventListener('ended', onEnded);
    const ping = window.setInterval(() => {
      if (!v.paused) send();
    }, 5000);
    const onHide = () => send(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(ping);
      window.removeEventListener('pagehide', onHide);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
      send(true);
    };
  }, [trackUrl]);

  return (
    <video ref={ref} className="vw-video" controls playsInline preload="metadata" aria-label={title} data-testid="video-player">
      <source src={src} type={type.split(';')[0]} />
    </video>
  );
}
