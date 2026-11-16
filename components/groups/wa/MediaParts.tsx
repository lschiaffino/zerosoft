'use client';

import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { duration, extensionOf, fileSize, posterFrame, splitFileName, waveBars } from './format';
import { DocIcon, MapPin, Mic, MusicIcon, Pause, Person, PhotoIcon, Play, Retry, Smiley } from './icons';
import PdfThumb, { PDF_THUMB_MAX_BYTES } from './PdfThumb';
import Avatar from './Avatar';
import { mediaBox, mediaBoxStyle, placeholderBox } from './media-box';
import { formatPhone } from '@/components/inbox/wa/util';

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

/** Lo que responde "bajar de nuevo": la URL (ya está), que WhatsApp ya no lo tiene, que la línea está desvinculada, o que quedó para más tarde. */
export type MediaRetryResult = { url: string } | { gone: true } | { offline: true } | { pending: true };

/** Estado de un archivo que no está: sin pedir, bajando, ya no está en WhatsApp, línea desvinculada, o no se pudo (se puede reintentar). */
export type MissingState = 'idle' | 'busy' | 'gone' | 'offline' | 'failed';

const missingOf = (r: MediaRetryResult): MissingState => ('gone' in r ? 'gone' : 'offline' in r ? 'offline' : 'failed');

/**
 * Reintento de una media que se sirve desde nuestra ruta (Inbox, o Lines ya
 * guardada): la pide otra vez sin caché. Con 200 la usa ya (sin bajarla dos
 * veces); 410: WhatsApp ya no la tiene; 409: la línea está desvinculada.
 */
export function refetchMedia(url: string): () => Promise<MediaRetryResult> {
  return async () => {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
    if (r?.ok && !(r.headers.get('content-type') ?? '').startsWith('application/json')) return { url: URL.createObjectURL(await r.blob()) };
    return r?.status === 410 ? { gone: true } : r?.status === 409 ? { offline: true } : { pending: true };
  };
}

/**
 * El pedido de "bajar de nuevo" de un archivo que no está, con su estado para
 * mostrar. `run()` devuelve la URL si volvió. Sin `onRetry` y con una URL
 * nuestra, vuelve a pedir esa misma URL.
 */
function useMissingMedia(url: string, onRetry: (() => Promise<MediaRetryResult>) | undefined, gone: boolean | undefined) {
  const [state, setState] = useState<MissingState>(gone ? 'gone' : 'idle');
  const retry = onRetry ?? (url.startsWith('/') ? refetchMedia(url) : undefined);
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const busy = useRef(false);
  const run = async (): Promise<string | null> => {
    const fn = retryRef.current;
    if (!fn || busy.current) return null;
    busy.current = true;
    setState('busy');
    const r = await fn().catch((): MediaRetryResult => ({ pending: true }));
    busy.current = false;
    if ('url' in r) {
      setState('idle');
      return r.url;
    }
    setState(missingOf(r));
    return null;
  };
  return { state, run, canRetry: Boolean(retry) };
}

/** El texto corto del estado de un archivo que no está (debajo del audio, en la tarjeta del documento). */
function useMissingLabel(): (state: MissingState, idle: string) => string {
  const tw = useTranslations('groups.wa');
  return (state, idle) =>
    state === 'busy' ? tw('downloadingAgain') : state === 'gone' ? tw('mediaGoneShort') : state === 'offline' ? tw('mediaOfflineShort') : state === 'failed' ? tw('mediaRetryFailed') : idle;
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
  gone,
  onRetry,
  onRecovered,
}: {
  id: string;
  /** '' si el archivo no está: el botón lo va a buscar. */
  src: string;
  /** Ya se sabe que WhatsApp no lo tiene (igual se puede volver a pedir). */
  gone?: boolean;
  /** Cómo volver a pedirlo (por defecto, la misma URL sin caché). */
  onRetry?: () => Promise<MediaRetryResult>;
  /** El audio volvió (para transcribirlo). */
  onRecovered?: (url: string) => void;
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
  // La URL que suena: la del mensaje, o la que trajo "bajar de nuevo".
  const [url, setUrl] = useState(src);
  // No está (sin archivo, o no cargó): el botón lo va a buscar en vez de quedar muerto.
  const [missing, setMissing] = useState(!src);
  const miss = useMissingMedia(src, onRetry, gone);
  const missLabel = useMissingLabel();
  const autoPlay = useRef(false);
  const triedOnce = useRef(false);
  const wantPlay = useRef(false);
  const recoveredRef = useRef(onRecovered);
  recoveredRef.current = onRecovered;
  useEffect(() => {
    setUrl(src);
    setMissing(!src);
    triedOnce.current = false;
  }, [src]);
  const failed = missing;
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

  /** Va a buscar el archivo (al gateway, y si hace falta al teléfono); si vuelve, suena. */
  async function recover() {
    triedOnce.current = true;
    const got = await miss.run();
    if (!got) return;
    autoPlay.current = true;
    setUrl(got);
    setMissing(false);
    recoveredRef.current?.(got);
  }

  // El archivo recién bajado: suena solo (la persona ya tocó reproducir).
  useEffect(() => {
    const a = ref.current;
    if (!a || !autoPlay.current || !url || missing) return;
    autoPlay.current = false;
    // Una sola a la vez, como al tocar reproducir.
    document.querySelectorAll<HTMLAudioElement>('audio.wa-audio-el').forEach((x) => x !== a && x.pause());
    a.playbackRate = speed;
    // Si el navegador no deja arrancar solo (pasó mucho desde el toque), el archivo ya está: queda listo para reproducir.
    void a.play().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, missing]);

  /** El archivo no cargó. Si la persona había tocado reproducir, se va a buscar solo (una vez). */
  function onLoadError() {
    setPlaying(false);
    setMissing(true);
    if (wantPlay.current && !triedOnce.current && miss.canRetry) void recover();
    wantPlay.current = false;
  }

  function toggle() {
    const a = ref.current;
    if (missing) return void recover();
    if (!a) return;
    if (a.paused) {
      // Una sola a la vez, como en WhatsApp.
      document.querySelectorAll<HTMLAudioElement>('audio.wa-audio-el').forEach((x) => x !== a && x.pause());
      if (!resumed.current) {
        resumed.current = true;
        if (time > 0 && (!total || time < total - 0.5)) a.currentTime = time;
      }
      a.playbackRate = speed;
      wantPlay.current = true;
      // play() también se rechaza cuando se pausa mientras carga (o empieza otro audio): eso no es un archivo que
      // falta. Solo cuenta el error del elemento (onError lo avisa igual).
      void a.play().catch(() => {
        if (a.error) onLoadError();
        else wantPlay.current = false;
      });
    } else a.pause();
  }

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    writeStore(SPEED_KEY, String(next));
  };

  return (
    <div
      className={`wa-voice${voice ? ' is-ptt' : ''}${active ? ' is-active' : ''}${failed ? ' is-failed' : ''}`}
      data-testid="wa-voice"
      data-state={failed ? miss.state : 'ready'}
      title={failed && miss.state === 'gone' ? tw('mediaGoneAudio') : failed && miss.state === 'offline' ? tw('mediaOffline') : undefined}
    >
      <audio
        ref={ref}
        className="wa-audio-el"
        src={url || undefined}
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
        onError={() => url && onLoadError()}
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
      <button
        type="button"
        className={`wa-voice-play${failed ? ' is-fetch' : ''}`}
        onClick={toggle}
        aria-label={failed ? (miss.state === 'gone' ? tw('askPhoneAgain') : tw('downloadAgain')) : playing ? tw('pause') : tw('play')}
        title={failed ? (miss.state === 'gone' ? tw('askPhoneAgain') : tw('downloadAgain')) : undefined}
        aria-busy={failed && miss.state === 'busy'}
        disabled={failed && (miss.state === 'busy' || !miss.canRetry)}
        data-testid="wa-voice-play"
      >
        {failed ? miss.state === 'idle' ? <Download size={22} /> : <Retry size={22} className={miss.state === 'busy' ? 'is-spinning' : undefined} /> : playing ? <Pause size={26} /> : <Play size={26} />}
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
          disabled={failed}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (ref.current) ref.current.currentTime = v;
            setTime(v);
          }}
        />
        <span className="wa-voice-meta" role={failed ? 'status' : undefined}>
          {failed ? missLabel(miss.state, tw('audioUnavailable')) : duration(active ? time : total)}
        </span>
      </div>
    </div>
  );
}

/** Baja un archivo ya traído (blob:) con su nombre, sin salir de la página. */
function saveFile(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'file';
  a.rel = 'noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Documento, como la tarjeta de WhatsApp: a la izquierda el ícono del tipo
 * (la hoja con la extensión en su color: PDF rojo, DOC azul, XLS verde), el
 * nombre en un renglón (cortado en el medio si es largo, para que se vea la
 * extensión) y abajo "45 kB • html". Toda la tarjeta abre o baja el archivo.
 * Sin archivo (o con `verify`, cuando el archivo se trae al pedirlo y puede
 * no estar): la tarjeta es un botón que lo va a buscar y dice qué pasó, nunca
 * un enlace que abre un error.
 */
export function DocCard({
  url,
  name,
  type,
  size,
  pages,
  thumbnail,
  saveThumbTo,
  gone,
  verify,
  onRetry,
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
  gone?: boolean;
  /** El archivo se baja del servidor de WhatsApp al pedirlo (Inbox): se comprueba antes de abrirlo. */
  verify?: boolean;
  onRetry?: () => Promise<MediaRetryResult>;
}) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const ext = extensionOf(name, type);
  const [pdfPages, setPdfPages] = useState<number | null>(null);
  // La URL que trajo "bajar de nuevo" (el archivo ya está en esta pestaña).
  const [got, setGot] = useState('');
  const miss = useMissingMedia(url, onRetry, gone);
  const missLabel = useMissingLabel();
  const shownPages = pages || pdfPages || 0;
  const meta = [shownPages ? t('wa.pages', { n: shownPages }) : '', size ? fileSize(size, locale) : '', ext.toLowerCase()].filter(Boolean).join(' • ');
  const isPdf = ext.toLowerCase() === 'pdf' || type === 'application/pdf';
  const shownName = name || t('media.file');
  const [nameHead, nameTail] = splitFileName(shownName);
  const href = got || url;
  const asButton = !got && (!url || Boolean(verify)) && miss.canRetry;
  // Con archivo a la vista (o todavía sin pedir, en Inbox): los datos del archivo. Si no, qué pasó.
  const problem = !href || (asButton && miss.state !== 'idle');
  const note = problem ? missLabel(miss.state, t('thread.fileUnavailable')) : meta;
  const inner = (
    <>
      {isPdf && thumbnail ? (
        <span className="wa-doc-thumb is-on" aria-hidden="true" data-testid="wa-doc-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnail} alt="" />
        </span>
      ) : (
        href && (!verify || got) && isPdf && !(size && size > PDF_THUMB_MAX_BYTES) && <PdfThumb url={href} onPages={setPdfPages} saveTo={saveThumbTo} />
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
        <span className="wa-doc-meta" role={asButton ? 'status' : undefined}>
          {note}
        </span>
      </span>
      {asButton && miss.state !== 'idle' && (
        <span className="wa-doc-dl" aria-hidden="true">
          <Retry size={18} className={miss.state === 'busy' ? 'is-spinning' : undefined} />
        </span>
      )}
    </>
  );
  if (asButton) {
    return (
      <button
        type="button"
        className={`wa-doc is-button${problem && miss.state !== 'busy' ? ' is-off' : ''}`}
        data-testid="wa-doc-retry"
        data-state={miss.state}
        disabled={miss.state === 'busy'}
        aria-busy={miss.state === 'busy'}
        title={miss.state === 'gone' ? t('wa.askPhoneAgain') : miss.state === 'offline' ? t('wa.mediaOffline') : url ? undefined : t('wa.downloadAgain')}
        onClick={async () => {
          const file = await miss.run();
          if (!file) return;
          setGot(file);
          saveFile(file, name);
        }}
      >
        {inner}
      </button>
    );
  }
  return href ? (
    <a className="wa-doc" href={href} target="_blank" rel="noreferrer" download={name || undefined} aria-label={`${t('wa.download')}: ${shownName}`} data-testid="wa-doc">
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
 * WhatsApp ya no lo tiene, lo dice así y ofrece pedírselo de nuevo al teléfono.
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
  const [state, setState] = useState<MissingState>(goneAtStart ? 'gone' : 'idle');
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
    setState('url' in r ? 'idle' : missingOf(r));
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
  const label =
    state === 'gone'
      ? kind === 'video'
        ? t('wa.mediaGoneVideo')
        : t('wa.mediaGoneImage')
      : state === 'busy'
        ? t('wa.downloadingAgain')
        : state === 'offline'
          ? t('wa.mediaOffline')
          : state === 'failed'
            ? t('wa.mediaRetryFailed')
            : t('thread.fileUnavailable');
  return (
    <span
      className={`wa-media-ph is-${kind}${state === 'gone' || state === 'offline' ? ' is-gone' : ''}`}
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
      {/* Mientras baja queda solo el aviso "Bajando…": el botón vuelve si no se pudo. También cuando "ya no está": se le puede volver a pedir al teléfono. */}
      {onRetry && state !== 'busy' && (
        <button type="button" className="wa-media-ph-retry" onClick={() => void run()} data-testid="wa-media-retry">
          <Retry size={16} />
          {state === 'gone' ? t('wa.askPhoneAgain') : t('wa.downloadAgain')}
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

/** Una tarjeta de contacto (vCard) como la ve la pantalla: el primer teléfono es el de WhatsApp. */
export interface SharedContact {
  name: string;
  phones?: string[];
  /** La foto guardada de esa persona (lib/wa-contact-pictures.ts), si hay. */
  picture?: string;
}

/** El teléfono de una tarjeta como lo muestra WhatsApp; uno oculto (Lines, sin permiso) queda como vino. */
export function cardPhoneLabel(raw: string): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  return /^\+?[\d\s-]+$/.test(v) ? formatPhone(v) : `+${v.replace(/^\+/, '')}`;
}

function ContactRow({ c }: { c: SharedContact }) {
  const phone = cardPhoneLabel(c.phones?.[0] ?? '');
  return (
    <span className="wa-contact">
      {c.picture ? (
        <Avatar name={c.name || phone} kind="dm" src={c.picture} seed={c.phones?.[0] || c.name} size={38} />
      ) : (
        <span className="wa-contact-avatar" aria-hidden="true">
          <Person size={22} />
        </span>
      )}
      <span className="wa-contact-text">
        <strong dir="auto">{c.name || phone}</strong>
        {phone && c.name && <span>{phone}</span>}
      </span>
    </span>
  );
}

/**
 * Contactos compartidos, como en WhatsApp: la foto de la persona (o el ícono), el nombre y el teléfono con
 * formato, y abajo "Enviar mensaje" (abre o crea su chat 1:1 en la misma cuenta o línea) y "Guardar contacto"
 * si hay dónde. Varios contactos en un mensaje: "Ana y 2 contactos más" con "Ver todos".
 */
export function ContactCards({ cards, onMessage, onSave }: { cards: SharedContact[]; onMessage?: (index: number) => void; onSave?: (index: number) => void }) {
  const tw = useTranslations('groups.wa');
  const [all, setAll] = useState(false);
  if (!cards.length) return null;
  const actions = (i: number) => {
    const has = !!cards[i].phones?.[0];
    if (!has || (!onMessage && !onSave)) return null;
    return (
      <span className="wa-contact-actions">
        {onMessage && (
          <button type="button" onClick={() => onMessage(i)} data-testid="wa-contact-message">
            {tw('contactMessage')}
          </button>
        )}
        {onSave && (
          <button type="button" onClick={() => onSave(i)}>
            {tw('contactSave')}
          </button>
        )}
      </span>
    );
  };
  if (cards.length === 1)
    return (
      <span className="wa-contact-card" data-testid="wa-contact-card">
        <ContactRow c={cards[0]} />
        {actions(0)}
      </span>
    );
  const first = cards[0];
  return (
    <span className="wa-contact-card" data-testid="wa-contact-card">
      <span className="wa-contact">
        {first.picture ? (
          <Avatar name={first.name} kind="dm" src={first.picture} seed={first.phones?.[0] || first.name} size={38} />
        ) : (
          <span className="wa-contact-avatar" aria-hidden="true">
            <Person size={22} />
          </span>
        )}
        <span className="wa-contact-text">
          <strong dir="auto">{tw('contactsMany', { name: first.name || cardPhoneLabel(first.phones?.[0] ?? ''), count: cards.length - 1 })}</strong>
        </span>
      </span>
      <span className="wa-contact-actions">
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? tw('contactsHide') : tw('contactsViewAll')}
        </button>
      </span>
      {all && (
        <span className="wa-contact-list">
          {cards.map((c, i) => (
            <span key={i} className="wa-contact-card">
              <ContactRow c={c} />
              {actions(i)}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
