'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { colorIndex, duration, extensionOf, fileSize } from './format';
import { DocIcon, Download, MapPin, Mic, Pause, Person, Play } from './icons';

/** Barras fijas por mensaje (parecen una onda, sin decodificar el audio). */
function bars(seed: string, n = 36): number[] {
  const out: number[] = [];
  let h = colorIndex(seed, 9973) + 7;
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    out.push(0.25 + ((h >> 8) % 1000) / 1333);
  }
  return out;
}

const SPEEDS = [1, 1.5, 2];

/** Nota de voz o audio: reproducir, avanzar, velocidad (como WhatsApp). */
export function VoicePlayer({ id, src, seconds, voice }: { id: string; src: string; seconds?: number; voice?: boolean }) {
  const t = useTranslations('groups.wa');
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(seconds ?? 0);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const shape = bars(id);
  const progress = total > 0 ? Math.min(1, time / total) : 0;

  useEffect(() => {
    const a = ref.current;
    if (a) a.playbackRate = speed;
  }, [speed]);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      // Una sola a la vez, como en WhatsApp.
      document.querySelectorAll<HTMLAudioElement>('audio.wa-audio-el').forEach((x) => x !== a && x.pause());
      void a.play().catch(() => setFailed(true));
    } else a.pause();
  }

  return (
    <div className={`wa-voice${voice ? ' is-ptt' : ''}${failed ? ' is-failed' : ''}`}>
      <audio
        ref={ref}
        className="wa-audio-el"
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setTotal(e.currentTarget.duration)}
        onError={() => setFailed(true)}
      />
      <button type="button" className="wa-voice-play" onClick={toggle} aria-label={playing ? t('pause') : t('play')} disabled={failed}>
        {playing ? <Pause size={24} /> : <Play size={24} />}
      </button>
      <div className="wa-voice-track">
        <div className="wa-voice-bars" aria-hidden="true">
          {shape.map((v, i) => (
            <i key={i} style={{ height: `${Math.round(v * 100)}%` }} className={i / shape.length < progress ? 'is-on' : ''} />
          ))}
        </div>
        <input
          type="range"
          className="wa-voice-seek"
          min={0}
          max={Math.max(1, total)}
          step={0.1}
          value={time}
          aria-label={t('seek')}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (ref.current) ref.current.currentTime = v;
            setTime(v);
          }}
        />
        <span className="wa-voice-meta">
          <span>{failed ? t('audioUnavailable') : duration(playing || time > 0 ? time : total)}</span>
          {playing && (
            <button type="button" className="wa-voice-speed" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} aria-label={t('speed')}>
              {speed}×
            </button>
          )}
        </span>
      </div>
      <span className={`wa-voice-badge${voice ? ' is-ptt' : ''}`} aria-hidden="true">
        <Mic size={14} />
      </span>
    </div>
  );
}

/** Documento: ícono, nombre, tipo y tamaño, y bajar (como la tarjeta de WhatsApp). */
export function DocCard({ url, name, type, size, pages }: { url: string; name: string; type: string; size?: number; pages?: number }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const ext = extensionOf(name, type);
  const meta = [pages ? t('wa.pages', { n: pages }) : '', ext, size ? fileSize(size, locale) : ''].filter(Boolean).join(' · ');
  const inner = (
    <>
      <span className={`wa-doc-icon wa-doc-${ext.toLowerCase().replace(/[^a-z]/g, '').slice(0, 4) || 'file'}`} aria-hidden="true">
        <DocIcon size={26} />
        <b>{ext.slice(0, 4)}</b>
      </span>
      <span className="wa-doc-main">
        <span className="wa-doc-name">{name || t('media.file')}</span>
        <span className="wa-doc-meta">{url ? meta : t('thread.fileUnavailable')}</span>
      </span>
      {url && (
        <span className="wa-doc-dl" aria-hidden="true">
          <Download size={18} />
        </span>
      )}
    </>
  );
  return url ? (
    <a className="wa-doc" href={url} target="_blank" rel="noreferrer" download={name || undefined}>
      {inner}
    </a>
  ) : (
    <span className="wa-doc is-off" title={t('thread.fileUnavailable')}>
      {inner}
    </span>
  );
}

/** Imagen o sticker. Abre el visor del chat (o en otra pestaña si no hay visor). */
export function ImageView({ url, alt, sticker, onLoad, onOpen }: { url: string; alt: string; sticker?: boolean; onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void; onOpen?: () => void }) {
  const [failed, setFailed] = useState(false);
  const t = useTranslations('groups');
  if (failed) {
    return <span className="wa-media-off">{t('thread.fileUnavailable')}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={url} alt={alt} loading="lazy" onLoad={onLoad} onError={() => setFailed(true)} />;
  if (onOpen && !sticker) {
    return (
      <button type="button" className="wa-image" onClick={onOpen} aria-label={t('wa.openMedia', { name: alt })}>
        {img}
      </button>
    );
  }
  return (
    <a className={`wa-image${sticker ? ' is-sticker' : ''}`} href={url} target="_blank" rel="noreferrer">
      {img}
    </a>
  );
}

/** Video: miniatura con el botón de reproducir; abre el visor (o se reproduce acá si no hay visor). */
export function VideoView({ url, round, seconds, onOpen }: { url: string; round?: boolean; seconds?: number; onOpen?: () => void }) {
  const t = useTranslations('groups');
  if (!onOpen) return <video className={`wa-video${round ? ' is-round' : ''}`} src={url} controls preload="metadata" playsInline />;
  return (
    <button type="button" className={`wa-video-thumb${round ? ' is-round' : ''}`} onClick={onOpen} aria-label={t('wa.playVideo')}>
      <video src={`${url}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" />
      <span className="wa-video-play" aria-hidden="true">
        <Play size={30} />
      </span>
      {seconds ? <span className="wa-video-len">{duration(seconds)}</span> : null}
    </button>
  );
}

/** Ubicación compartida: abre el mapa. */
export function LocationCard({ lat, lng, name, address }: { lat: number; lng: number; name: string; address?: string }) {
  const t = useTranslations('groups.wa');
  const href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
  return (
    <a className="wa-location" href={href} target="_blank" rel="noreferrer">
      <span className="wa-location-map" aria-hidden="true">
        <MapPin size={28} />
      </span>
      <span className="wa-location-text">
        <strong>{name || t('location')}</strong>
        {address && address !== name && <span>{address}</span>}
        <span className="wa-location-coords">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
      </span>
    </a>
  );
}

/** Contacto compartido. */
export function ContactCard({ name, phone }: { name: string; phone: string }) {
  return (
    <span className="wa-contact">
      <span className="wa-contact-avatar" aria-hidden="true">
        <Person size={22} />
      </span>
      <span className="wa-contact-text">
        <strong>{name}</strong>
        {phone && <span>+{phone}</span>}
      </span>
    </span>
  );
}
