'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { chapterAt, fmtClock, trimmedDuration, type RecChapter } from '@/lib/rec-schema';

export interface RecMarker {
  id: string;
  atSec: number;
  emoji: string | null;
  label: string;
}

export interface RecPlayerHandle {
  /** Ir al segundo `t` (del video recortado). */
  seek(t: number): void;
  /** Segundo actual (del video recortado). */
  current(): number;
  /** Elemento de video (para tomar un frame como miniatura). */
  video(): HTMLVideoElement | null;
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
  }
>(function RecPlayer(props, ref) {
  const { src, captionsSrc, poster, title, durationSec, trimStart, trimEnd, chapters = [], markers = [], cta, trackUrl, viewerName, onTime, compact } = props;
  const t = useTranslations('rec.player');
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const track = useRef({ viewId: '', opening: false, watched: 0, position: 0, last: 0 });

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

  useImperativeHandle(ref, () => ({ seek, current: () => time, video: () => video.current }), [seek, time]);

  // ---------- Seguimiento de la vista ----------
  const send = useCallback(
    (extra: { cta?: boolean } = {}, beacon = false) => {
      if (!trackUrl) return;
      const s = track.current;
      const body = JSON.stringify({
        viewId: s.viewId || undefined,
        watched: Math.round(s.watched),
        position: Math.round(s.position * 10) / 10,
        duration: Math.round(visible * 10) / 10,
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
      body: JSON.stringify({ duration: Math.round(visible * 10) / 10, name: viewerName?.() || undefined }),
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
      if (!v.paused && delta > 0 && delta < 2) s.watched += delta;
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
  }, [trimStart, end, visible, onTime, openView, send]);

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    for (const tr of Array.from(v.textTracks)) tr.mode = captions ? 'showing' : 'hidden';
  }, [captions, captionsSrc]);

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
      <div className="rec-player-media">
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
        >
          {captionsSrc && <track kind="captions" src={captionsSrc} default={false} label={t('captions')} />}
        </video>
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
        <div className="rec-timeline">
          <input
            type="range"
            className="rec-timeline-range"
            min={0}
            max={Math.max(0.1, visible)}
            step={0.1}
            value={Math.min(time, visible)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label={t('seek')}
            aria-valuetext={`${fmtClock(time)} / ${fmtClock(visible)}`}
            style={{ ['--pct' as string]: `${(Math.min(time, visible) / visible) * 100}%` }}
          />
          {chapters.slice(1).map((c) => (
            <span key={`c${c.start}`} className="rec-tick" style={{ left: `${((c.start - trimStart) / visible) * 100}%` }} aria-hidden="true" />
          ))}
          {markers
            .filter((m) => m.atSec >= trimStart && m.atSec <= end)
            .slice(-50)
            .map((m) => (
              <button
                key={m.id}
                type="button"
                className={`rec-marker${m.emoji ? ' emoji' : ''}`}
                style={{ left: `${((m.atSec - trimStart) / visible) * 100}%` }}
                onClick={() => seek(m.atSec - trimStart)}
                title={m.label}
                aria-label={m.label}
                tabIndex={-1}
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

export default RecPlayer;
