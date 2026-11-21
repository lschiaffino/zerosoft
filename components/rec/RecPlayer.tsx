'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { chapterAt, fmtClock, mergeRanges, spriteTile, trimmedDuration, type Range, type RecChapter, type RecOverlay, type RecSpriteMeta } from '@/lib/rec-schema';
import { HEAT_BUCKETS } from '@/lib/rec-insights';

/** Solo el dominio de donde vino quien mira (nunca la ruta ni la query); '' si es esta misma página. */
function referrerHost(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    const u = new URL(document.referrer);
    return u.host === window.location.host ? undefined : u.hostname;
  } catch {
    return undefined;
  }
}

export interface RecMarker {
  id: string;
  atSec: number;
  emoji: string | null;
  label: string;
  /** Reacción: quién la dejó (se muestra en el cuadro que abre la marca). */
  who?: string;
  /** Reacción que quien mira puede quitar (la suya, o cualquiera si administra el video). */
  remove?: () => void;
}

export interface RecPlayerHandle {
  /** Ir al segundo `t` (del video recortado). */
  seek(t: number): void;
  /** Segundo actual (del video recortado). */
  current(): number;
  /** Elemento de video (para tomar un frame como miniatura). */
  video(): HTMLVideoElement | null;
  /** Emoji que sube sobre el video (al reaccionar). */
  pop(emoji: string): void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Reproductor de Rec: respeta el recorte (inicio y fin), velocidad,
 * subtítulos, capítulos y marcas de comentarios y reacciones en la línea de
 * tiempo, y la llamada a la acción (todo el video o al final). Con `trackUrl`
 * abre la vista al primer play y manda pings de lo visto cada 5 s.
 *
 * Teclado (con el foco en el reproductor): espacio o K reproduce y pausa,
 * flechas 5 s, J y L 10 s, M silencia, C subtítulos, F pantalla completa.
 */
const RecPlayer = forwardRef<
  RecPlayerHandle,
  {
    src: string;
    captionsSrc?: string | null;
    poster?: string | null;
    title: string;
    durationSec: number;
    trimStart: number;
    trimEnd: number | null;
    chapters?: RecChapter[];
    markers?: RecMarker[];
    cta?: { label: string; url: string; mode: 'always' | 'end' } | null;
    trackUrl?: string;
    viewerName?: () => string;
    onTime?: (t: number) => void;
    compact?: boolean;
    overlays?: RecOverlay[];
    /** Sin descarga: el menú del navegador no ofrece "guardar video". */
    noDownload?: boolean;
    /** Tira de miniaturas: vista previa al pasar o arrastrar por la línea de tiempo. */
    sprite?: { url: string; meta: RecSpriteMeta } | null;
    /** Silencios (segundos del original, de la transcripción): "Saltar silencios" los pasa de largo. */
    silences?: Range[];
    /** Segundo (del video recortado) donde arranca, como el `?t=` de un link. */
    startAt?: number | null;
    /** Reproduce al cargar, sin sonido (los navegadores solo dejan así). */
    autoPlay?: boolean;
  }
>(function RecPlayer(props, ref) {
  const { src, captionsSrc, poster, title, durationSec, trimStart, trimEnd, chapters = [], markers = [], cta, trackUrl, viewerName, onTime, compact, overlays = [], noDownload, sprite, silences = [], startAt = null, autoPlay = false } = props;
  const t = useTranslations('rec.player');
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(autoPlay);
  const [captions, setCaptions] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  /** Vista previa de la línea de tiempo: segundo (del video recortado) y posición en px dentro del video. */
  const [scrub, setScrub] = useState<{ t: number; x: number; w: number; tol: number } | null>(null);
  const [spriteOk, setSpriteOk] = useState(false);
  const media = useRef<HTMLDivElement>(null);
  /** Emojis que suben sobre el video: los de las reacciones al pasar por su segundo, y el propio al reaccionar. */
  const [pops, setPops] = useState<Array<{ id: number; emoji: string; x: number }>>([]);
  const popSeq = useRef(0);
  const [skipSilences, setSkipSilences] = useState(false);
  /** Cuadro de una reacción de la línea de tiempo: la marca abierta y su centro en px dentro del video. */
  const [markOpen, setMarkOpen] = useState<{ id: string; x: number } | null>(null);
  const markPop = useRef<HTMLDivElement>(null);
  /** La marca que toma el foco con Tab (después, flechas entre marcas). */
  const [markFocus, setMarkFocus] = useState<string | null>(null);
  // Lo que lee el evento timeupdate sin volver a engancharse.
  const live = useRef({ markers, silences, skipSilences });
  live.current = { markers, silences, skipSilences };
  // ranges: intervalos realmente reproducidos (segundos del video recortado), para el % visto.
  // heat: segundos reproducidos en cada tramo, contando re-vistas (la curva de la analítica).
  const track = useRef({ viewId: '', opening: false, watched: 0, position: 0, last: 0, ranges: [] as Range[], heat: new Array<number>(HEAT_BUCKETS).fill(0) });

  const fullDuration = mediaDuration > 0 ? mediaDuration : durationSec;
  const end = trimEnd ?? fullDuration;
  const visible = Math.max(0.1, trimmedDuration(fullDuration, trimStart, trimEnd));

  const seek = useCallback(
    (rel: number) => {
      const v = video.current;
      if (!v) return;
      const target = Math.max(0, Math.min(rel, visible - 0.05));
      v.currentTime = trimStart + target;
      setTime(target);
      setEnded(false);
    },
    [trimStart, visible],
  );

  const pop = useCallback((emoji: string) => {
    const id = ++popSeq.current;
    setPops((prev) => [...prev.slice(-5), { id, emoji, x: 12 + Math.random() * 76 }]);
    window.setTimeout(() => setPops((prev) => prev.filter((p) => p.id !== id)), 2200);
  }, []);

  useImperativeHandle(ref, () => ({ seek, current: () => time, video: () => video.current, pop }), [seek, time, pop]);

  // Arranque pedido por el embed: primero el segundo, después el play sin sonido.
  // Si el navegador no deja reproducir solo, queda el botón de play.
  const startedRef = useRef(false);
  useEffect(() => {
    const v = video.current;
    if (!v || startedRef.current) return;
    startedRef.current = true;
    if (startAt && startAt > 0) seek(startAt);
    if (autoPlay) {
      v.muted = true;
      v.play().catch(() => {});
    }
  }, [startAt, autoPlay, seek]);

  // ---------- Seguimiento de la vista ----------
  const send = useCallback(
    (extra: { cta?: boolean } = {}, beacon = false) => {
      if (!trackUrl) return;
      const s = track.current;
      const body = JSON.stringify({
        viewId: s.viewId || undefined,
        watched: Math.round(s.watched),
        ranges: mergeRanges(s.ranges, visible),
        position: Math.round(s.position * 10) / 10,
        duration: Math.round(visible * 10) / 10,
        heat: s.heat.map((x) => Math.round(x * 10) / 10),
        name: viewerName?.() || undefined,
        ...extra,
      });
      if (!s.viewId && !extra.cta) return;
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(trackUrl, new Blob([body], { type: 'application/json' }));
      else void fetch(trackUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
    },
    [trackUrl, visible, viewerName],
  );

  const openView = useCallback(() => {
    const s = track.current;
    if (!trackUrl || s.viewId || s.opening) return;
    s.opening = true;
    void fetch(trackUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ duration: Math.round(visible * 10) / 10, name: viewerName?.() || undefined, ref: referrerHost() }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { viewId?: string | null } | null) => {
        if (d?.viewId) s.viewId = d.viewId;
      })
      .catch(() => undefined)
      .finally(() => {
        s.opening = false;
      });
  }, [trackUrl, visible, viewerName]);

  useEffect(() => {
    if (!trackUrl) return;
    const ping = window.setInterval(() => {
      if (video.current && !video.current.paused) send();
    }, 5000);
    const onHide = () => send({}, true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(ping);
      window.removeEventListener('pagehide', onHide);
    };
  }, [trackUrl, send]);

  // ---------- Eventos del video ----------
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onMeta = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setMediaDuration(v.duration);
      if (v.currentTime < trimStart) v.currentTime = trimStart;
    };
    const onTimeUpdate = () => {
      const s = track.current;
      const abs = v.currentTime;
      if (abs < trimStart - 0.25) v.currentTime = trimStart;
      if (end && abs >= end - 0.05 && !v.paused) {
        v.pause();
        setEnded(true);
        s.position = visible;
        send();
      }
      const rel = Math.max(0, Math.min(abs - trimStart, visible));
      const delta = rel - s.last;
      const { markers: marks, silences: gaps, skipSilences: skip } = live.current;
      // Reproduciendo de corrido: las reacciones del tramo que pasó suben sobre el video, como en Loom.
      if (!v.paused && delta > 0 && delta < 2) {
        for (const m of marks) {
          const at = m.atSec - trimStart;
          if (m.emoji && at > s.last && at <= rel) pop(m.emoji);
        }
      }
      // Saltar silencios: dentro de un hueco sin voz, al final del hueco.
      if (skip && !v.paused) {
        const gap = gaps.find(([a, b]) => abs >= a + 0.3 && abs < b - 0.6);
        if (gap) v.currentTime = Math.min(gap[1] - 0.25, end || gap[1]);
      }
      if (!v.paused && delta > 0 && delta < 2) {
        s.watched += delta;
        const lastRange = s.ranges[s.ranges.length - 1];
        if (lastRange && Math.abs(lastRange[1] - s.last) < 0.01) lastRange[1] = rel;
        else s.ranges.push([s.last, rel]);
        if (s.ranges.length > 200) s.ranges = mergeRanges(s.ranges, visible);
        if (visible > 0) {
          const b = Math.min(HEAT_BUCKETS - 1, Math.max(0, Math.floor(((s.last + rel) / 2 / visible) * HEAT_BUCKETS)));
          s.heat[b] += delta;
        }
      }
      s.last = rel;
      s.position = Math.max(s.position, rel);
      setTime(rel);
      onTime?.(rel);
    };
    const onPlay = () => {
      setPlaying(true);
      setEnded(false);
      track.current.last = Math.max(0, v.currentTime - trimStart);
      openView();
    };
    const onPause = () => {
      setPlaying(false);
      send();
    };
    const onEnded = () => {
      setPlaying(false);
      setEnded(true);
      track.current.position = visible;
      send();
    };
    const onSeeked = () => {
      track.current.last = Math.max(0, v.currentTime - trimStart);
    };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('seeked', onSeeked);
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('seeked', onSeeked);
    };
  }, [trimStart, end, visible, onTime, openView, send, pop]);

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    for (const tr of Array.from(v.textTracks)) tr.mode = captions ? 'showing' : 'hidden';
  }, [captions, captionsSrc]);

  // La tira se carga una vez; si no está (todavía se arma, o es de otra versión), la vista previa muestra solo el tiempo.
  useEffect(() => {
    setSpriteOk(false);
    if (!sprite?.url) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive) setSpriteOk(true);
    };
    img.src = sprite.url;
    return () => {
      alive = false;
    };
  }, [sprite?.url]);

  const openMark = markOpen ? (markers.find((m) => m.id === markOpen.id && m.emoji) ?? null) : null;
  const markOpenId = openMark ? openMark.id : null;

  // El cuadro de la reacción se cierra con un clic o toque afuera, con Esc y al cambiar el tamaño.
  useEffect(() => {
    if (!markOpenId) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el && (markPop.current?.contains(el) || el.closest('.rec-marker'))) return;
      setMarkOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      const inside = markPop.current?.contains(document.activeElement);
      setMarkOpen(null);
      // El foco vuelve a la marca si estaba en el cuadro.
      if (inside) wrap.current?.querySelector<HTMLElement>(`.rec-marker[data-marker="${CSS.escape(markOpenId)}"]`)?.focus({ preventScroll: true });
    };
    const onResize = () => setMarkOpen(null);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [markOpenId]);

  function onMarker(m: RecMarker, el: HTMLElement, byKeyboard: boolean) {
    seek(m.atSec - trimStart);
    if (!m.emoji) return;
    if (markOpen?.id === m.id) {
      setMarkOpen(null);
      return;
    }
    const box = media.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!box) return;
    setScrub(null);
    setMarkOpen({ id: m.id, x: r.left + r.width / 2 - box.left });
    // Con teclado el foco pasa a "Quitar reacción"; con el mouse se queda donde estaba (un espacio no la borra sin querer).
    if (byKeyboard) window.requestAnimationFrame(() => markPop.current?.querySelector('button')?.focus({ preventScroll: true }));
  }

  function scrubAt(clientX: number, el: HTMLElement) {
    const box = el.getBoundingClientRect();
    const m = media.current?.getBoundingClientRect();
    if (!m || box.width <= 0) return;
    const frac = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    // tol: a cuántos segundos queda una marca a 8 px del cursor (para mostrar su comentario).
    setScrub({ t: frac * visible, x: clientX - m.left, w: m.width, tol: (8 / box.width) * visible });
  }

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (ended || v.currentTime >= end - 0.1) v.currentTime = trimStart;
      void v.play().catch(() => undefined);
    } else v.pause();
  }

  function fullscreen() {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  }

  function onKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea, [role="menu"]')) return;
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = {
      ' ': toggle,
      k: toggle,
      arrowleft: () => seek(time - 5),
      arrowright: () => seek(time + 5),
      j: () => seek(time - 10),
      l: () => seek(time + 10),
      m: () => setMuted((m) => !m),
      c: () => captionsSrc && setCaptions((c) => !c),
      f: fullscreen,
    };
    if (target.tagName === 'BUTTON' && (k === ' ' || k === 'enter')) return;
    const fn = map[k];
    if (!fn) return;
    e.preventDefault();
    fn();
  }

  const chapterIdx = chapterAt(chapters, time);
  // En orden de tiempo: así las flechas van de una marca a la siguiente.
  const shownMarkers = markers
    .filter((m) => m.atSec >= trimStart && m.atSec <= end)
    .slice(-50)
    .sort((a, b) => a.atSec - b.atSec);
  const rovingId = shownMarkers.some((m) => m.id === markFocus) ? markFocus : (shownMarkers[0]?.id ?? null);
  const showCta = !!cta && (cta.mode === 'always' || ended);

  return (
    <div
      ref={wrap}
      className={`rec-player${compact ? ' compact' : ''}${playing ? ' playing' : ''}`}
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={t('label', { title })}
      role="region"
      data-testid="rec-player"
    >
      <div className="rec-player-media" ref={media}>
        <video
          ref={video}
          className="rec-player-video"
          src={src}
          poster={poster ?? undefined}
          preload="metadata"
          playsInline
          muted={muted}
          onClick={toggle}
          aria-label={title}
          data-testid="rec-video"
          controlsList={noDownload ? 'nodownload' : undefined}
          onContextMenu={noDownload ? (e) => e.preventDefault() : undefined}
        >
          {captionsSrc && <track kind="captions" src={captionsSrc} default={false} label={t('captions')} />}
        </video>
        {overlays.length > 0 && (
          <div className="rec-overlay-layer" aria-hidden={false}>
            {overlays
              .filter((o) => trimStart + time >= o.start && trimStart + time < o.end)
              .map((o) =>
                o.kind === 'arrow' ? (
                  <svg key={o.id} className="rec-overlay rec-overlay-arrow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-testid="rec-overlay-shown">
                    <line x1={o.x * 100} y1={o.y * 100} x2={Math.min(100, (o.x + o.w) * 100)} y2={Math.min(100, (o.y + o.h) * 100)} stroke={o.color} strokeWidth={3} vectorEffect="non-scaling-stroke" />
                    <circle cx={Math.min(100, (o.x + o.w) * 100)} cy={Math.min(100, (o.y + o.h) * 100)} r={1.4} fill={o.color} />
                  </svg>
                ) : o.kind === 'box' ? (
                  <span key={o.id} className="rec-overlay rec-overlay-box" style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%`, borderColor: o.color }} data-testid="rec-overlay-shown" />
                ) : (
                  <span key={o.id} className="rec-overlay rec-overlay-text" style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, maxWidth: `${Math.max(10, o.w * 100)}%`, background: o.color, color: o.color === '#ffffff' || o.color === '#f59e0b' ? '#111111' : '#ffffff' }} data-testid="rec-overlay-shown">
                    {o.text}
                  </span>
                ),
              )}
          </div>
        )}
        {openMark && markOpen && (
          <div
            ref={markPop}
            className="rec-mark-pop"
            role="dialog"
            aria-label={t('reaction', { name: openMark.who ?? '', emoji: openMark.emoji ?? '' })}
            style={{ ['--x' as string]: `${markOpen.x}px` }}
            data-testid="rec-mark-pop"
          >
            <span className="rec-mark-emoji" aria-hidden="true">
              {openMark.emoji}
            </span>
            <span className="rec-mark-who">{openMark.who}</span>
            <span className="rec-mark-at data">{t('reactionAt', { time: fmtClock(Math.max(0, openMark.atSec - trimStart)) })}</span>
            {openMark.remove && (
              <button
                type="button"
                className="btn btn-ghost btn-danger btn-sm rec-mark-remove"
                onClick={() => {
                  const hadFocus = markPop.current?.contains(document.activeElement);
                  openMark.remove?.();
                  setMarkOpen(null);
                  if (hadFocus) wrap.current?.focus({ preventScroll: true });
                }}
                data-testid="rec-mark-remove"
              >
                {t('removeReaction')}
              </button>
            )}
          </div>
        )}
        {scrub && !openMark && (
          <ScrubPreview
            scrub={scrub}
            sprite={spriteOk ? (sprite ?? null) : null}
            chapter={chapters[chapterAt(chapters, trimStart + scrub.t)]?.title ?? ''}
            note={nearestMarker(markers, scrub.t + trimStart, scrub.tol)?.label ?? ''}
          />
        )}
        {pops.length > 0 && (
          <div className="rec-pops" aria-hidden="true">
            {pops.map((p) => (
              <span key={p.id} className="rec-pop" style={{ left: `${p.x}%` }} data-testid="rec-pop">
                {p.emoji}
              </span>
            ))}
          </div>
        )}
        {!playing && (
          <button type="button" className="rec-player-big" onClick={toggle} aria-label={t('play')}>
            <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          </button>
        )}
        {showCta && cta && (
          <a
            className="btn btn-primary rec-player-cta"
            href={cta.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={() => send({ cta: true })}
            data-testid="rec-cta"
          >
            {cta.label}
          </a>
        )}
      </div>
      <div className="rec-player-bar">
        <button type="button" className="btn btn-ghost btn-sm rec-player-btn" onClick={toggle} aria-label={playing ? t('pause') : t('play')}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span className="rec-player-time data" aria-hidden="true">
          {fmtClock(time)} / {fmtClock(visible)}
        </span>
        <div
          className="rec-timeline"
          onPointerMove={(e) => scrubAt(e.clientX, e.currentTarget)}
          onPointerDown={(e) => scrubAt(e.clientX, e.currentTarget)}
          onPointerLeave={() => setScrub(null)}
          onPointerUp={(e) => {
            if (e.pointerType !== 'mouse') setScrub(null);
          }}
          onPointerCancel={() => setScrub(null)}
          data-testid="rec-timeline"
        >
          <input
            type="range"
            className="rec-timeline-range"
            min={0}
            max={Math.max(0.1, visible)}
            step={1}
            value={Math.min(time, visible)}
            onChange={(e) => seek(Number(e.target.value))}
            onKeyDown={(e) => {
              // Flechas: 1 s; con Shift, 5 s.
              if (!e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
              e.preventDefault();
              e.stopPropagation();
              seek(time + (e.key === 'ArrowRight' ? 5 : -5));
            }}
            aria-label={t('seek')}
            aria-valuetext={`${fmtClock(time)} / ${fmtClock(visible)}`}
            style={{ ['--pct' as string]: `${(Math.min(time, visible) / visible) * 100}%` }}
          />
          {chapters.slice(1).map((c) => (
            <span key={`c${c.start}`} className="rec-tick" style={{ left: `${((c.start - trimStart) / visible) * 100}%` }} aria-hidden="true" />
          ))}
          {shownMarkers.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={`rec-marker${m.emoji ? ' emoji' : ''}`}
              style={{ left: `${((m.atSec - trimStart) / visible) * 100}%` }}
              onClick={(e) => onMarker(m, e.currentTarget, e.detail === 0)}
              onFocus={() => setMarkFocus(m.id)}
              onKeyDown={(e) => {
                // Un solo Tab para todas las marcas; entre ellas, con las flechas (sin mover el video).
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                e.stopPropagation();
                const next = shownMarkers[i + (e.key === 'ArrowRight' ? 1 : -1)];
                if (next) e.currentTarget.parentElement?.querySelector<HTMLElement>(`.rec-marker[data-marker="${CSS.escape(next.id)}"]`)?.focus();
              }}
              title={openMark?.id === m.id ? undefined : m.label}
              aria-label={m.label}
              aria-haspopup={m.emoji ? 'dialog' : undefined}
              aria-expanded={m.emoji ? openMark?.id === m.id : undefined}
              tabIndex={m.id === rovingId ? 0 : -1}
              data-marker={m.id}
            >
              {m.emoji ?? ''}
            </button>
          ))}
        </div>
        {chapterIdx >= 0 && !compact && <span className="rec-player-chapter">{chapters[chapterIdx].title}</span>}
        <div className="rec-speed">
          <button
            type="button"
            className="btn btn-ghost btn-sm rec-player-btn data"
            aria-haspopup="menu"
            aria-expanded={speedOpen}
            onClick={() => setSpeedOpen((o) => !o)}
            aria-label={t('speed', { speed: `${speed}x` })}
            data-testid="rec-speed"
          >
            {speed}x
          </button>
          {speedOpen && (
            <div
              className="rec-menu"
              role="menu"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setSpeedOpen(false);
                }
              }}
            >
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="menuitemradio"
                  aria-checked={speed === s}
                  className="rec-menu-item"
                  autoFocus={speed === s}
                  onClick={() => {
                    setSpeed(s);
                    setSpeedOpen(false);
                  }}
                >
                  {s}x
                </button>
              ))}
              {silences.length > 0 && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={skipSilences}
                  className="rec-menu-item"
                  onClick={() => {
                    setSkipSilences((v) => !v);
                    setSpeedOpen(false);
                  }}
                  data-testid="rec-skip-silences"
                >
                  {t('skipSilences')}
                </button>
              )}
            </div>
          )}
        </div>
        {captionsSrc && (
          <button type="button" className="btn btn-ghost btn-sm rec-player-btn" aria-pressed={captions} onClick={() => setCaptions((c) => !c)}>
            CC
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm rec-player-btn" aria-pressed={muted} onClick={() => setMuted((m) => !m)} aria-label={muted ? t('unmute') : t('mute')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
            {muted ? <path d="M17 9l4 6M21 9l-4 6" /> : <path d="M16 8.5a5 5 0 010 7" />}
          </svg>
        </button>
        <button type="button" className="btn btn-ghost btn-sm rec-player-btn" onClick={fullscreen} aria-label={t('fullscreen')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
    </div>
  );
});

/** La marca (comentario o reacción) más cerca del segundo `abs`, si está a menos de `tol`. */
function nearestMarker(markers: RecMarker[], abs: number, tol: number): RecMarker | null {
  let best: RecMarker | null = null;
  for (const m of markers) if (Math.abs(m.atSec - abs) <= tol && (!best || Math.abs(m.atSec - abs) < Math.abs(best.atSec - abs))) best = m;
  return best;
}

/** Cuadro y tiempo sobre la línea de tiempo, como YouTube o Loom. */
function ScrubPreview({ scrub, sprite, chapter, note }: { scrub: { t: number; x: number; w: number }; sprite: { url: string; meta: RecSpriteMeta } | null; chapter: string; note: string }) {
  // En pantallas angostas el cuadro es más chico (la tira se escala igual).
  const width = scrub.w < 480 ? 112 : 160;
  const left = Math.max(6, Math.min(scrub.x - width / 2, scrub.w - width - 6));
  let frame: CSSProperties | null = null;
  if (sprite) {
    const k = width / sprite.meta.w;
    const { x, y } = spriteTile(sprite.meta, scrub.t);
    frame = {
      width,
      height: Math.round(sprite.meta.h * k),
      backgroundImage: `url("${sprite.url}")`,
      backgroundSize: `${sprite.meta.cols * sprite.meta.w * k}px auto`,
      backgroundPosition: `${-x * k}px ${-y * k}px`,
    };
  }
  return (
    <div className="rec-scrub" style={{ left, width }} aria-hidden="true" data-testid="rec-scrub">
      {frame && <span className="rec-scrub-frame" style={frame} data-testid="rec-scrub-frame" />}
      {note && (
        <span className="rec-scrub-note" data-testid="rec-scrub-note">
          {note}
        </span>
      )}
      {chapter && <span className="rec-scrub-chapter">{chapter}</span>}
      <span className="rec-scrub-time data">{fmtClock(scrub.t)}</span>
    </div>
  );
}

export default RecPlayer;
