'use client';

import { useEffect, useRef, useState } from 'react';
import { duration } from './format';
import { Pause, Play } from './icons';

export interface ScheduledVoiceLabels {
  /** "🎤 Nota de voz (0:05)". */
  tag: (time: string) => string;
  play: string;
  pause: string;
  /** El audio no se pudo reproducir. */
  failed: string;
}

/**
 * Una nota de voz programada, en la tira de programados (Lines e Inbox): su
 * duración y un botón para escucharla antes de que salga. El audio se pide
 * recién al tocar reproducir.
 */
export default function ScheduledVoice({ src, seconds, labels }: { src: string; seconds: number; labels: ScheduledVoiceLabels }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  // Otro programado (o el mismo con otro audio): vuelve al principio.
  useEffect(() => {
    setPlaying(false);
    setFailed(false);
  }, [src]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (!a.paused) {
      a.pause();
      return;
    }
    setFailed(false);
    a.play().catch((err: unknown) => {
      // Pausar enseguida corta el play() (AbortError): no es un audio roto.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setPlaying(false);
      setFailed(true);
    });
  };

  return (
    <span className={`wa-sched-voice${failed ? ' is-failed' : ''}`} data-testid="scheduled-voice">
      <button type="button" className="wa-sched-voice-play" onClick={toggle} aria-label={playing ? labels.pause : labels.play} title={playing ? labels.pause : labels.play} aria-pressed={playing}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <span className="wa-sched-voice-text">{labels.tag(duration(Math.max(0, Math.round(seconds))))}</span>
      {failed && (
        <span className="wa-sched-voice-error" role="alert">
          {labels.failed}
        </span>
      )}
      <audio
        ref={ref}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          if (ref.current) ref.current.currentTime = 0;
        }}
        onError={() => {
          setPlaying(false);
          if (ref.current?.error) setFailed(true);
        }}
      />
    </span>
  );
}
