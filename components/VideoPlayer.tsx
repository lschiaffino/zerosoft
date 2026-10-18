'use client';

import { useEffect, useRef } from 'react';

export interface VideoPlayerProps {
  /** URL del MP4 (ej. "/videos/crm.mp4"). */
  src: string;
  /** Imagen previa (ej. "/videos/crm.jpg"). */
  poster: string;
  /** Texto accesible del video (aria-label). */
  title: string;
  /** Reproduce (muteado) cuando entra en pantalla y pausa al salir. */
  autoPlayOnVisible?: boolean;
  /** Repetir en loop (útil con autoPlayOnVisible). */
  loop?: boolean;
  /** Mostrar los controles nativos. Default: true. */
  controls?: boolean;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Video de producto: grabaciones reales del app con captions quemados.
 * Sin audio, muteado, playsInline y preload="none" (no descarga nada hasta
 * que se reproduce). Respeta prefers-reduced-motion: no hace autoplay.
 */
export default function VideoPlayer({
  src,
  poster,
  title,
  autoPlayOnVisible = false,
  loop = false,
  controls = true,
  width = 1280,
  height = 720,
  className,
}: VideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!autoPlayOnVisible || !video || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [autoPlayOnVisible]);

  return (
    <video
      ref={ref}
      className={className}
      src={src}
      poster={poster}
      aria-label={title}
      title={title}
      width={width}
      height={height}
      controls={controls}
      muted
      playsInline
      loop={loop}
      preload="none"
      style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${width} / ${height}`, background: 'var(--brand-enamel)' }}
    />
  );
}
