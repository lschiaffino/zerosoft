'use client';

import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { duration, extensionOf, fileSize, posterFrame, splitFileName, waveBars } from './format';
import { DocIcon, MapPin, Mic, MusicIcon, Pause, Person, PhotoIcon, Play, Retry, Smiley } from './icons';
import PdfThumb, { PDF_THUMB_MAX_BYTES } from './PdfThumb';
import Avatar from './Avatar';
import { mediaBox, mediaBoxStyle, placeholderBox } from './media-box';

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

/**
 * Documento, como la tarjeta de WhatsApp: a la izquierda el ícono del tipo
 * (la hoja con la extensión en su color: PDF rojo, DOC azul, XLS verde), el
 * nombre en un renglón (cortado en el medio si es largo, para que se vea la
 * extensión) y abajo "45 kB • html". Toda la tarjeta abre o baja el archivo.
 */
export function DocCard({
  url,
  name,
  type,
  size,
  pages,
  thumbnail,
  saveThumbTo,
}: {
  url: string;
  name: string;
  type: string;
  size?: number;
  pages?: number;
  /** Vista previa de la primera página: la que mandó WhatsApp con el mensaje o la que ya se guardó. */
  thumbnail?: string;
  /** Ruta del mensaje donde guardar la vista previa la primera vez que se dibuja (PDF sin miniatura). */
  saveThumbTo?: string;
}) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const ext = extensionOf(name, type);
  const [pdfPages, setPdfPages] = useState<number | null>(null);
  const shownPages = pages || pdfPages || 0;
  const meta = [shownPages ? t('wa.pages', { n: shownPages }) : '', size ? fileSize(size, locale) : '', ext.toLowerCase()].filter(Boolean).join(' • ');
  const isPdf = ext.toLowerCase() === 'pdf' || type === 'application/pdf';
  const shownName = name || t('media.file');
  const [nameHead, nameTail] = splitFileName(shownName);
  const inner = (
    <>
      {isPdf && thumbnail ? (
        <span className="wa-doc-thumb is-on" aria-hidden="true" data-testid="wa-doc-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnail} alt="" />
        </span>
      ) : (
        url && isPdf && !(size && size > PDF_THUMB_MAX_BYTES) && <PdfThumb url={url} onPages={setPdfPages} saveTo={saveThumbTo} />
      )}
      <span className={`wa-doc-icon wa-doc-${ext.toLowerCase().replace(/[^a-z]/g, '').slice(0, 4) || 'file'}`} aria-hidden="true">
        <DocIcon size={30} strokeWidth={1.5} />
        {ext && <b>{ext.slice(0, 4)}</b>}
      </span>
      <span className="wa-doc-main">
        {/* Un renglón, cortado en el medio: el principio se achica con "…" y el final (la extensión) queda siempre. */}
        <span className="wa-doc-name" title={shownName}>
          <span className="wa-doc-name-head">{nameHead}</span>
          {nameTail && <span className="wa-doc-name-tail">{nameTail}</span>}
        </span>
        <span className="wa-doc-meta">{url ? meta : t('thread.fileUnavailable')}</span>
      </span>
    </>
  );
  return url ? (
    <a className="wa-doc" href={url} target="_blank" rel="noreferrer" download={name || undefined} aria-label={`${t('wa.download')}: ${shownName}`} data-testid="wa-doc">
      {inner}
    </a>
  ) : (
    <span className="wa-doc is-off" title={t('thread.fileUnavailable')} data-testid="wa-doc">
      {inner}
    </span>
  );
}

const boxFor = mediaBox;
const boxStyle = mediaBoxStyle;

/** Lo que responde "bajar de nuevo": la URL (ya está), que WhatsApp ya no lo tiene, o que quedó para más tarde. */
export type MediaRetryResult = { url: string } | { gone: true } | { pending: true };

/**
 * Reintento de una media que se sirve desde nuestra ruta (Inbox, o Lines ya
 * guardada): la pide otra vez sin caché. Con 200 la usa ya (sin bajarla dos
 * veces); 410: WhatsApp ya no la tiene.
 */
export function refetchMedia(url: string): () => Promise<MediaRetryResult> {
  return async () => {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
    if (r?.ok && (r.headers.get('content-type') ?? '').match(/^(image|video)\//)) return { url: URL.createObjectURL(await r.blob()) };
    return r?.status === 410 ? { gone: true } : { pending: true };
  };
}

/** Lo que ya se reintentó solo en esta pestaña (una vez por media): el automático no se repite en cada render. */
const autoRetried = new Set<string>();

/**
 * Foto o video que no está (no se pudo bajar, o el archivo ya no carga): el
 * mismo lugar que ocuparía la foto (sus medidas si se saben, si no el
 * estándar), con la miniatura borrosa de WhatsApp si vino y el aviso al
 * centro. La burbuja mantiene el ancho y el texto de abajo se lee normal.
 *
 * Con `onRetry`: se reintenta solo una vez al aparecer (el servidor le pide el
 * archivo a WhatsApp, y si venció, al teléfono) y queda "Bajar de nuevo". Si
 * WhatsApp ya no lo tiene, lo dice así y no ofrece reintentar.
 */
export function MediaUnavailable({
  kind = 'image',
  width,
  height,
  thumbnail,
  gone: goneAtStart,
  onRetry,
  retryKey,
  onRecovered,
}: {
  kind?: 'image' | 'video';
  width?: number;
  height?: number;
  thumbnail?: string;
  gone?: boolean;
  onRetry?: () => Promise<MediaRetryResult>;
  /** Id de la media para el reintento automático (uno por pestaña). */
  retryKey?: string;
  onRecovered?: (url: string) => void;
}) {
  const t = useTranslations('groups');
  const [state, setState] = useState<'idle' | 'busy' | 'gone'>(goneAtStart ? 'gone' : 'idle');
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;
  const recoveredRef = useRef(onRecovered);
  recoveredRef.current = onRecovered;
  const run = async () => {
    const retry = retryRef.current;
    if (!retry) return;
    setState('busy');
    const r = await retry().catch((): MediaRetryResult => ({ pending: true }));
    if ('url' in r) recoveredRef.current?.(r.url);
    setState('gone' in r ? 'gone' : 'idle');
  };
  useEffect(() => {
    if (goneAtStart || !retryKey || !retryRef.current || autoRetried.has(retryKey)) return;
    const timer = setTimeout(() => {
      if (autoRetried.has(retryKey)) return;
      autoRetried.add(retryKey);
      void run();
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey, goneAtStart]);
  const label = state === 'gone' ? (kind === 'video' ? t('wa.mediaGoneVideo') : t('wa.mediaGoneImage')) : state === 'busy' ? t('wa.downloadingAgain') : t('thread.fileUnavailable');
  return (
    <span
      className={`wa-media-ph is-${kind}${state === 'gone' ? ' is-gone' : ''}`}
      style={mediaBoxStyle(placeholderBox(width, height, Boolean(thumbnail)))}
      data-testid="wa-media-unavailable"
      data-state={state}
    >
      {thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="wa-thumb" src={thumbnail} alt="" aria-hidden="true" />
      )}
      <span className="wa-media-ph-note" role="status">
        {kind === 'video' ? <Play size={18} /> : <PhotoIcon size={18} />}
        <span>{label}</span>
      </span>
      {/* Mientras baja queda solo el aviso "Bajando…": el botón vuelve si no se pudo. */}
      {onRetry && state === 'idle' && (
        <button type="button" className="wa-media-ph-retry" onClick={() => void run()} data-testid="wa-media-retry">
          <Retry size={16} />
          {t('wa.downloadAgain')}
        </button>
      )}
    </span>
  );
}

/**
 * Foto o video sin archivo guardado (Lines): el lugar con "Bajar de nuevo" y,
 * si vuelve, la media en su lugar.
 */
export function MissingMedia({
  kind,
  width,
  height,
  thumbnail,
  gone,
  onRetry,
  retryKey,
  seconds,
}: {
  kind: 'image' | 'video';
  width?: number;
  height?: number;
  thumbnail?: string;
  gone?: boolean;
  onRetry?: () => Promise<MediaRetryResult>;
  retryKey?: string;
  seconds?: number;
}) {
  const [url, setUrl] = useState('');
  const t = useTranslations('groups');
  if (url && kind === 'image') return <ImageView url={url} alt={t('thread.image')} width={width} height={height} thumbnail={thumbnail} />;
  if (url) return <VideoView url={url} seconds={seconds} thumbnail={thumbnail} width={width} height={height} />;
  return <MediaUnavailable kind={kind} width={width} height={height} thumbnail={thumbnail} gone={gone} onRetry={onRetry} retryKey={retryKey} onRecovered={setUrl} />;
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
  onRetry,
  retryKey,
}: {
  url: string;
  alt: string;
  sticker?: boolean;
  thumbnail?: string;
  width?: number;
  height?: number;
  onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void;
  onOpen?: () => void;
  /** Si no carga: cómo volver a pedirla (por defecto, la misma URL sin caché). */
  onRetry?: () => Promise<MediaRetryResult>;
  retryKey?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // La URL que se dibuja: la del mensaje, o la que trajo "bajar de nuevo".
  const [src, setSrc] = useState(url);
  useEffect(() => {
    setSrc(url);
    setFailed(false);
  }, [url]);
  const ref = useRef<HTMLImageElement>(null);
  // Una imagen que ya estaba en caché termina de cargar antes de que React escuche onLoad.
  useEffect(() => {
    const el = ref.current;
    if (!el?.complete) return;
    if (el.naturalWidth > 0) setLoaded(true);
    // Lo mismo si falló antes (la página llegó dibujada del servidor y el error pasó antes de que React escuchara):
    // sin esto la foto rota quedaba en blanco, sin el aviso.
    else if (el.currentSrc || el.getAttribute('src')) setFailed(true);
  }, [src]);
  const t = useTranslations('groups');
  if (failed) {
    if (sticker) return <StickerMissing label={t('thread.fileUnavailable')} />;
    return (
      <MediaUnavailable
        width={width}
        height={height}
        thumbnail={thumbnail}
        onRetry={onRetry ?? (url.startsWith('/') ? refetchMedia(url) : undefined)}
        retryKey={retryKey ?? url}
        onRecovered={(u) => {
          setSrc(u);
          setLoaded(false);
          setFailed(false);
        }}
      />
    );
  }
  // Sin medidas, mientras carga: el lugar estándar (la burbuja no queda angosta); al cargar, su tamaño real.
  const box = sticker ? null : (boxFor(width, height) ?? (loaded ? null : placeholderBox()));
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
        src={src}
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
  // Un sticker no abre el visor ni otra pestaña (como en WhatsApp): chico, sin burbuja, animado si lo es.
  if (sticker) {
    return (
      <span className="wa-image is-sticker" role="img" aria-label={alt}>
        {img}
      </span>
    );
  }
  return (
    <a className="wa-image" style={style} href={url} target="_blank" rel="noreferrer">
      {img}
    </a>
  );
}

/** Sticker que no se puede dibujar (Lottie, o el archivo no se pudo bajar): el lugar del sticker, como un sticker. */
export function StickerMissing({ label }: { label: string }) {
  return (
    <span className="wa-image is-sticker is-missing" role="img" aria-label={label}>
      <Smiley size={40} />
      <span>{label}</span>
    </span>
  );
}

/**
 * GIF de WhatsApp (un video con gifPlayback): adentro de la burbuja, se
 * reproduce solo, sin sonido y en bucle, con la marca "GIF"; un clic abre el
 * visor. Con movimiento reducido queda quieto.
 */
export function GifView({ url, thumbnail, width, height, onOpen }: { url: string; thumbnail?: string; width?: number; height?: number; onOpen?: () => void }) {
  const t = useTranslations('groups');
  const ref = useRef<HTMLVideoElement>(null);
  const style = boxStyle(boxFor(width, height));
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) v.pause();
    else void v.play().catch(() => null);
  }, [url]);
  return (
    <button type="button" className="wa-video-thumb wa-gif" style={style} onClick={onOpen} aria-label={t('wa.openGif')}>
      <video ref={ref} src={url} poster={thumbnail} muted loop playsInline autoPlay preload="auto" tabIndex={-1} aria-hidden="true" />
      <span className="wa-gif-badge" aria-hidden="true">
        GIF
      </span>
    </button>
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
