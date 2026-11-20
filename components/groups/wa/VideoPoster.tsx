'use client';

import { useEffect, useRef, useState } from 'react';
import { posterFrame } from './format';
import { posterState } from './video-poster';

/**
 * Portada de un video: la miniatura de WhatsApp (borrosa) de lugar y, cuando
 * la burbuja está cerca de la pantalla, un <video preload="metadata"> con
 * #t=0.1 por la ruta de media (con sesión): el navegador pide por rangos solo
 * el principio del archivo y dibuja el primer cuadro. No se baja el video
 * entero ni se piden los que no se ven. Si no se puede dibujar (sin archivo,
 * un navegador que no precarga), queda la miniatura.
 */
export default function VideoPoster({
  url,
  thumbnail,
  onSize,
}: {
  url: string;
  thumbnail?: string;
  /** Medidas leídas del archivo (para la caja cuando el mensaje no las trae). */
  onSize?: (w: number, h: number) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = url ? posterFrame(url) : '';

  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [src]);

  useEffect(() => {
    const el = ref.current;
    if (!el || near || !src) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src, near]);

  const state = posterState(ready, thumbnail);
  return (
    <span ref={ref} className="wa-poster" data-poster={state} aria-hidden="true">
      {thumbnail && !ready && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="wa-thumb" src={thumbnail} alt="" />
      )}
      {near && src && !failed && (
        <video
          src={src}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          ref={(v) => {
            // Ya tenía el cuadro (de la caché) antes de que React escuchara.
            if (v && v.readyState >= 2 && !ready) setReady(true);
          }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth > 0 && v.videoHeight > 0) onSize?.(v.videoWidth, v.videoHeight);
          }}
          onLoadedData={() => setReady(true)}
          onSeeked={(e) => {
            if (e.currentTarget.readyState >= 2) setReady(true);
          }}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
