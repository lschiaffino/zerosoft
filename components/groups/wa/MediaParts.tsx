'use client';

import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { duration, extensionOf, fileSize, posterFrame, waveBars } from './format';
import { DocIcon, Download, MapPin, Mic, MusicIcon, Pause, Person, Play } from './icons';
import PdfThumb, { PDF_THUMB_MAX_BYTES } from './PdfThumb';
import Avatar from './Avatar';

const SPEEDS = [1, 1.5, 2];
const POS_KEY = 'wa-voice-pos:';
const SPEED_KEY = 'wa-voice-speed';

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Sin storage: no se recuerda.
  }
}

/**
 * Nota de voz o audio: reproducir, avanzar, velocidad 1×/1,5×/2× (queda
 * elegida), forma de onda real si WhatsApp la manda, y sigue donde se dejó
 * (la posición queda en este navegador hasta terminarlo).
 */
export function VoicePlayer({
  id,
  src,
  seconds,
  voice,
  name,
  waveform,
  avatar,
}: {
  id: string;
  src: string;
  seconds?: number;
  voice?: boolean;
  name?: string;
  waveform?: number[];
  /** Quién la grabó: su foto (o iniciales) va a la izquierda con el micrófono, como en WhatsApp. */
  avatar?: { name: string; src?: string; seed?: string };
}) {
  const tw = useTranslations('groups.wa');
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(seconds ?? 0);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const shape = waveBars(waveform, id, 40);
  const progress = total > 0 ? Math.min(1, time / total) : 0;
  // Empezada (sonando o con posición): a la izquierda va la velocidad en vez de la foto, como en WhatsApp.
  const active = playing || time > 0;

  // Velocidad elegida y dónde había quedado este audio.
  useEffect(() => {
    const s = Number(readStore(SPEED_KEY));
    if (SPEEDS.includes(s)) setSpeed(s);
    const p = Number(readStore(POS_KEY + id));
    if (p > 0) setTime(p);
  }, [id]);

  useEffect(() => {
    const a = ref.current;
    if (a) a.playbackRate = speed;
  }, [speed]);

  // Al empezar, retoma desde la posición guardada.
  const resumed = useRef(false);
  useEffect(() => {
    resumed.current = false;
  }, [id]);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      // Una sola a la vez, como en WhatsApp.
      document.querySelectorAll<HTMLAudioElement>('audio.wa-audio-el').forEach((x) => x !== a && x.pause());
      if (!resumed.current) {
        resumed.current = true;
        if (time > 0 && (!total || time < total - 0.5)) a.currentTime = time;
      }
      a.playbackRate = speed;
      void a.play().catch(() => setFailed(true));
    } else a.pause();
  }

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    writeStore(SPEED_KEY, String(next));
  };

  return (
    <div className={`wa-voice${voice ? ' is-ptt' : ''}${active ? ' is-active' : ''}${failed ? ' is-failed' : ''}`}>
      <audio
        ref={ref}
        className="wa-audio-el"
        src={src}
        preload={voice ? 'none' : 'metadata'}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
          writeStore(POS_KEY + id, null);
        }}
        onTimeUpdate={(e) => {
          const pos = e.currentTarget.currentTime;
          setTime(pos);
          if (pos > 1) writeStore(POS_KEY + id, pos.toFixed(1));
        }}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setTotal(e.currentTarget.duration)}
        onError={() => setFailed(true)}
      />
      <span className="wa-voice-lead">
        {active ? (
          <button type="button" className="wa-voice-speed" onClick={cycleSpeed} aria-label={`${tw('speed')}: ${speed}×`}>
            {speed}×
          </button>
        ) : voice ? (
          <span className="wa-voice-avatar" aria-hidden="true">
            {avatar ? <Avatar name={avatar.name} src={avatar.src} seed={avatar.seed} kind="dm" size={44} /> : <span className="wa-voice-avatar-blank" />}
            <span className="wa-voice-mic">
              <Mic size={16} />
            </span>
          </span>
        ) : (
          <span className="wa-voice-badge is-audio" aria-hidden="true">
            <MusicIcon size={18} />
          </span>
        )}
      </span>
      <button type="button" className="wa-voice-play" onClick={toggle} aria-label={playing ? tw('pause') : tw('play')} disabled={failed}>
        {playing ? <Pause size={26} /> : <Play size={26} />}
      </button>
      <div className="wa-voice-track" style={{ ['--p' as string]: progress }}>
        {voice ? (
          <div className="wa-voice-bars" aria-hidden="true">
            {shape.map((v, i) => (
              <i key={i} style={{ height: `${Math.round(v * 100)}%` }} className={i / shape.length < progress ? 'is-on' : ''} />
            ))}
            <b className="wa-voice-knob" />
          </div>
        ) : (
          <div className="wa-audio-line" aria-hidden="true">
            {name && <span className="wa-audio-name">{name}</span>}
            <span className="wa-audio-bar">
              <i style={{ width: `${progress * 100}%` }} />
            </span>
          </div>
        )}
        <input
          type="range"
          className="wa-voice-seek"
          min={0}
          max={Math.max(1, total)}
          step={0.1}
          value={time}
          aria-label={tw('seek')}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (ref.current) ref.current.currentTime = v;
            setTime(v);
          }}
        />
        <span className="wa-voice-meta">{failed ? tw('audioUnavailable') : duration(active ? time : total)}</span>
      </div>
    </div>
  );
}

/** Documento: ícono, nombre, tipo y tamaño, y bajar (como la tarjeta de WhatsApp). */
export function DocCard({ url, name, type, size, pages }: { url: string; name: string; type: string; size?: number; pages?: number }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const ext = extensionOf(name, type);
  const [pdfPages, setPdfPages] = useState<number | null>(null);
  const shownPages = pages || pdfPages || 0;
  const meta = [shownPages ? t('wa.pages', { n: shownPages }) : '', ext, size ? fileSize(size, locale) : ''].filter(Boolean).join(' · ');
  const isPdf = ext.toLowerCase() === 'pdf' || type === 'application/pdf';
  const inner = (
    <>
      {url && isPdf && !(size && size > PDF_THUMB_MAX_BYTES) && <PdfThumb url={url} onPages={setPdfPages} />}
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

/** Caja de la foto desde su ancho y alto (hasta 300 de ancho y alto, igual que .wa-image en styles/groups-wa.css). */
function boxFor(width?: number, height?: number): { width: number; height: number } | null {
  if (!width || !height) return null;
  const scale = Math.min(300 / width, 300 / height, 1);
  return { width: Math.max(100, Math.round(width * scale)), height: Math.max(60, Math.round(height * scale)) };
}

/**
 * Estilo de la caja: el ancho en proporción a --wa-media-w (300px por
 * defecto; Visualización lo cambia a chico o grande) y la proporción real.
 */
function boxStyle(box: { width: number; height: number } | null): CSSProperties | undefined {
  return box ? { width: `calc(var(--wa-media-w, 300px) * ${+(box.width / 300).toFixed(4)})`, aspectRatio: `${box.width} / ${box.height}` } : undefined;
}

/**
 * Imagen o sticker. Con la miniatura de WhatsApp de fondo (borrosa) hasta que
 * carga el archivo. Abre el visor del chat (o en otra pestaña si no hay visor).
 */
export function ImageView({
  url,
  alt,
  sticker,
  thumbnail,
  width,
  height,
  onLoad,
  onOpen,
}: {
  url: string;
  alt: string;
  sticker?: boolean;
  thumbnail?: string;
  width?: number;
  height?: number;
  onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void;
  onOpen?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // Una imagen que ya estaba en caché termina de cargar antes de que React escuche onLoad.
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, [url]);
  const t = useTranslations('groups');
  if (failed) {
    return <span className="wa-media-off">{t('thread.fileUnavailable')}</span>;
  }
  const box = sticker ? null : boxFor(width, height);
  const style = boxStyle(box);
  const img = (
    <>
      {thumbnail && !loaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="wa-thumb" src={thumbnail} alt="" aria-hidden="true" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src={url}
        alt={alt}
        loading="lazy"
        className={loaded ? 'is-loaded' : ''}
        onLoad={(e) => {
          setLoaded(true);
          onLoad?.(e);
        }}
        onError={() => setFailed(true)}
      />
    </>
  );
  if (onOpen && !sticker) {
    return (
      <button type="button" className="wa-image" style={style} onClick={onOpen} aria-label={t('wa.openMedia', { name: alt })}>
        {img}
      </button>
    );
  }
  return (
    <a className={`wa-image${sticker ? ' is-sticker' : ''}`} style={style} href={url} target="_blank" rel="noreferrer">
      {img}
    </a>
  );
}

/** Video: miniatura con el botón de reproducir y la duración; abre el visor. */
export function VideoView({ url, seconds, thumbnail, width, height, onOpen }: { url: string; seconds?: number; thumbnail?: string; width?: number; height?: number; onOpen?: () => void }) {
  const t = useTranslations('groups');
  const box = boxFor(width, height);
  const style = boxStyle(box);
  if (!onOpen) return <video className="wa-video" src={url} controls preload="metadata" playsInline />;
  return (
    <button type="button" className="wa-video-thumb" style={style} onClick={onOpen} aria-label={t('wa.playVideo')}>
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnail} alt="" aria-hidden="true" />
      ) : (
        <video src={posterFrame(url)} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" />
      )}
      <span className="wa-video-play" aria-hidden="true">
        <Play size={30} />
      </span>
      {seconds ? <span className="wa-video-len">{duration(seconds)}</span> : null}
    </button>
  );
}

/** Ubicación compartida: abre el mapa (sin mapa incrustado). */
export function LocationCard({ lat, lng, name, address, url, live }: { lat: number; lng: number; name: string; address?: string; url?: string; live?: boolean }) {
  const tw = useTranslations('groups.wa');
  const href = url && /^https:\/\//.test(url) ? url : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
  return (
    <a className="wa-location" href={href} target="_blank" rel="noreferrer">
      <span className="wa-location-map" aria-hidden="true">
        <MapPin size={28} />
      </span>
      <span className="wa-location-text">
        <strong>{name || (live ? tw('liveLocation') : tw('location'))}</strong>
        {address && address !== name && <span>{address}</span>}
        <span className="wa-location-coords">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
      </span>
    </a>
  );
}

/** Contacto compartido, con "Enviar mensaje" (busca su chat) y "Guardar" (lo agrega al CRM). */
export function ContactCard({ name, phone, onMessage, onSave }: { name: string; phone: string; onMessage?: () => void; onSave?: () => void }) {
  const tw = useTranslations('groups.wa');
  return (
    <span className="wa-contact-card">
      <span className="wa-contact">
        <span className="wa-contact-avatar" aria-hidden="true">
          <Person size={22} />
        </span>
        <span className="wa-contact-text">
          <strong>{name}</strong>
          {phone && <span>+{phone}</span>}
        </span>
      </span>
      {phone && (onMessage || onSave) && (
        <span className="wa-contact-actions">
          {onMessage && (
            <button type="button" onClick={onMessage}>
              {tw('contactMessage')}
            </button>
          )}
          {onSave && (
            <button type="button" onClick={onSave}>
              {tw('contactSave')}
            </button>
          )}
        </span>
      )}
    </span>
  );
}
