'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { REC_MODES, fmtClock, keptMs, rewindKeep, type RecKeep, type RecMode } from '@/lib/rec-schema';
import { patchWebmDuration } from '@/lib/rec-webm';
import { encodeGif, type GifFrame } from '@/lib/rec-gif';
import {
  INK_COLORS,
  LOW_LIGHT_FILTER,
  QUALITY,
  audioLevel,
  cameraBlurSupported,
  canvasFilterSupported,
  canvasToBlob,
  createTicker,
  drawBubble,
  drawInk,
  drawPointer,
  floatingWindowSupported,
  inkAlpha,
  mixAudio,
  openFloatingWindow,
  setCameraBlur,
  pickAudioMime,
  pickVideoMime,
  recorderSupported,
  screenSupported,
  snapshot,
  type BubbleFrame,
  type BubbleShape,
  type InkStroke,
  type QualityKey,
} from './recorder-media';

/**
 * Grabador de Rec (como Loom), compartido con los videos 1:1 del CRM.
 *
 * - Modos: pantalla y cámara (la cámara en una burbuja que se arrastra y se
 *   agranda sobre la vista previa, compuesta en un canvas), solo pantalla y
 *   solo cámara. La pantalla, ventana o pestaña se elige en el selector del
 *   navegador.
 * - Cámara y micrófono con selector de dispositivo, supresión de ruido y
 *   audio de la pestaña o del sistema (si el navegador lo comparte), mezclados
 *   en una pista. Medidor de nivel.
 * - Calidad 720p, 1080p o 4K (según la fuente), cuenta regresiva de 3 s
 *   (Esc la cancela), pausar y retomar.
 * - Con `sink` (Rec) cada trozo sale mientras se graba para subirlo por
 *   partes; sin él (CRM) se arma el archivo entero al final, con la duración
 *   escrita en el header para poder adelantar.
 * - Al terminar entrega miniatura JPEG y GIF de los primeros segundos.
 * - Notas para leer mientras se graba (solo las ve quien graba), ventana
 *   flotante con los controles arriba de cualquier app, forma y marco de la
 *   burbuja, más luz, y lápiz y puntero sobre la vista previa.
 * - Con `rewind`, pausado se puede volver atrás: lo sacado se corta del archivo
 *   al terminar (ver finishRecording).
 */

export interface RecordingResult {
  /** Archivo completo (solo sin `sink`). */
  blob: Blob | null;
  mime: string;
  mode: RecMode;
  durationSec: number;
  width: number;
  height: number;
  thumbnail: Blob | null;
  gif: Blob | null;
  /** Pista de audio aparte (para transcribir), si se pidió `captureAudioTrack`. */
  audio: Blob | null;
  audioMime: string | null;
  /** Tramos que quedan si se volvió atrás (ms del archivo); null si no se tocó nada. */
  keep: RecKeep | null;
}

export interface RecorderSink {
  /** Antes del primer trozo (crear el video y pedir dónde subir). Si tira, no se graba. */
  begin(info: { mime: string; mode: RecMode }): Promise<void>;
  chunk(data: Blob): void;
  abort(): void;
}

type Phase = 'setup' | 'countdown' | 'recording' | 'paused' | 'finishing';

interface Bubble {
  /** Centro, en fracción del ancho y alto del video. */
  x: number;
  y: number;
  /** Diámetro, en fracción del alto. */
  d: number;
}

const GIF_FRAMES = 12;
const GIF_EVERY_MS = 250;
const GIF_WIDTH = 320;
const NOTES_KEY = 'rec-speaker-notes';
/** Al retomar después de volver atrás: margen para que el corte caiga en un keyframe (cada 2 s) antes de que hables. */
const REWIND_LEAD_MS = 2200;
const FILE_TOOLS_KEY = 'rec-recorder-look';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function Recorder({
  modes = REC_MODES,
  initialMode,
  sink,
  onDone,
  onCancel,
  captureAudioTrack = false,
  onPhase,
  status,
  rewind = false,
  canRewind = true,
}: {
  modes?: readonly RecMode[];
  initialMode?: RecMode;
  sink?: RecorderSink;
  onDone: (r: RecordingResult) => void;
  onCancel?: () => void;
  captureAudioTrack?: boolean;
  onPhase?: (phase: Phase) => void;
  /** Estado de la subida y de la red, en la barra mientras se graba. */
  status?: ReactNode;
  /** Ofrecer volver atrás estando en pausa (necesita WebM y una subida que se pueda rearmar). */
  rewind?: boolean;
  /** Falso si la grabación ya es muy pesada para rearmarla en el navegador. */
  canRewind?: boolean;
}) {
  const t = useTranslations('rec.recorder');
  const [mode, setMode] = useState<RecMode>(initialMode && modes.includes(initialMode) ? initialMode : modes[0]);
  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState<string | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState('');
  const [micId, setMicId] = useState('');
  const [noise, setNoise] = useState(true);
  const [systemAudio, setSystemAudio] = useState(true);
  const [quality, setQuality] = useState<QualityKey>('1080');
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [bubble, setBubble] = useState<Bubble>({ x: 0.14, y: 0.78, d: 0.3 });
  const [supported, setSupported] = useState(true);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(true);
  const [shape, setShape] = useState<BubbleShape>('circle');
  const [frame, setFrame] = useState<BubbleFrame>('white');
  const [lowLight, setLowLight] = useState(false);
  const [filterOk, setFilterOk] = useState(true);
  const [blurOk, setBlurOk] = useState(false);
  const [blur, setBlur] = useState(false);
  const [drawTools, setDrawTools] = useState(false);
  const [tool, setTool] = useState<'none' | 'pen' | 'pointer'>('none');
  const [inkColor, setInkColor] = useState<string>(INK_COLORS[0]);
  const [floatWin, setFloatWin] = useState<Window | null>(null);
  const [floatOk, setFloatOk] = useState(false);
  const [rewound, setRewound] = useState<number[]>([]);
  const [lead, setLead] = useState(0);

  const camStream = useRef<MediaStream | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const camVideo = useRef<HTMLVideoElement>(null);
  const screenVideo = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioChunks = useRef<Blob[]>([]);
  const stopTicker = useRef<(() => void) | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const activeMs = useRef(0);
  const resumedAt = useRef(0);
  const gifFrames = useRef<GifFrame[]>([]);
  const lastGifAt = useRef(-Infinity);
  const thumb = useRef<Blob | null>(null);
  const thumbPending = useRef(false);
  const bubbleRef = useRef(bubble);
  const countdownTimer = useRef<number | null>(null);
  const cancelled = useRef(false);
  const mimeRef = useRef('');
  const levelBuf = useRef(new Uint8Array(256));
  const sizeRef = useRef({ width: 0, height: 0 });
  const lookRef = useRef({ shape, frame, lowLight });
  lookRef.current = { shape, frame, lowLight };
  const strokes = useRef<InkStroke[]>([]);
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  /** Tramos ya cerrados del archivo y dónde arrancó el actual (ms del archivo). */
  const keepRef = useRef<RecKeep>([]);
  const segStart = useRef(0);
  const usedRewind = useRef(false);
  const history = useRef<RecKeep[]>([]);
  const leadTimer = useRef<number | null>(null);
  // Los textos de error se leen por ref: el efecto de la vista previa no se re-ejecuta por un `t` nuevo.
  const tRef = useRef(t);
  tRef.current = t;

  bubbleRef.current = bubble;
  const usesCamera = mode !== 'screen';
  const usesScreen = mode !== 'camera';
  // Se compone en el lienzo lo que no se puede grabar directo: la burbuja, el lápiz y el filtro de luz.
  const composited = mode === 'screen_camera' || (mode === 'screen' && drawTools) || (mode === 'camera' && lowLight);
  const compositedRef = useRef(composited);
  compositedRef.current = composited;

  useEffect(() => {
    setSupported(recorderSupported());
    setFilterOk(canvasFilterSupported());
    setFloatOk(floatingWindowSupported());
    try {
      setNotes(window.localStorage.getItem(NOTES_KEY) ?? '');
      const look = JSON.parse(window.localStorage.getItem(FILE_TOOLS_KEY) ?? '{}') as { shape?: BubbleShape; frame?: BubbleFrame; lowLight?: boolean };
      if (look.shape === 'circle' || look.shape === 'square') setShape(look.shape);
      if (look.frame && ['white', 'dark', 'accent', 'none'].includes(look.frame)) setFrame(look.frame);
      if (look.lowLight) setLowLight(true);
    } catch {
      // Sin almacenamiento arranca con los valores de siempre.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(NOTES_KEY, notes);
      window.localStorage.setItem(FILE_TOOLS_KEY, JSON.stringify({ shape, frame, lowLight }));
    } catch {
      // Sin almacenamiento no se recuerda: nada más.
    }
  }, [notes, shape, frame, lowLight]);

  useEffect(() => {
    onPhase?.(phase);
  }, [phase, onPhase]);

  const stopTracks = (s: MediaStream | null) => s?.getTracks().forEach((tr) => tr.stop());

  const releaseAll = useCallback(() => {
    stopTicker.current?.();
    stopTicker.current = null;
    stopTracks(camStream.current);
    stopTracks(micStream.current);
    stopTracks(screenStream.current);
    camStream.current = null;
    micStream.current = null;
    screenStream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    analyser.current = null;
  }, []);

  useEffect(() => () => {
    if (countdownTimer.current) window.clearTimeout(countdownTimer.current);
    if (leadTimer.current) window.clearTimeout(leadTimer.current);
    if (recorder.current && recorder.current.state !== 'inactive') {
      cancelled.current = true;
      recorder.current.stop();
    }
    releaseAll();
  }, [releaseAll]);

  // Vista previa de cámara y micrófono mientras se configura.
  useEffect(() => {
    if (phase !== 'setup' || !supported) return;
    let alive = true;
    const acquire = async () => {
      setError(null);
      stopTracks(camStream.current);
      stopTracks(micStream.current);
      camStream.current = null;
      micStream.current = null;
      try {
        const q = QUALITY[quality];
        if (usesCamera) {
          const cam = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: Math.min(q.width, 1920) }, height: { ideal: Math.min(q.height, 1080) } },
          });
          if (!alive) return stopTracks(cam);
          camStream.current = cam;
          setBlurOk(cameraBlurSupported(cam.getVideoTracks()[0]));
          if (camVideo.current) {
            camVideo.current.srcObject = cam;
            void camVideo.current.play().catch(() => undefined);
          }
        }
        if (micId !== 'none') {
          const mic = await navigator.mediaDevices
            .getUserMedia({ audio: { deviceId: micId ? { exact: micId } : undefined, noiseSuppression: noise, echoCancellation: noise, autoGainControl: true } })
            .catch(() => null);
          if (!alive) return stopTracks(mic);
          micStream.current = mic;
          const mixed = mixAudio([mic]);
          void audioCtx.current?.close().catch(() => undefined);
          audioCtx.current = mixed.ctx;
          analyser.current = mixed.analyser;
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!alive) return;
        setCams(devices.filter((d) => d.kind === 'videoinput'));
        setMics(devices.filter((d) => d.kind === 'audioinput'));
      } catch (err) {
        if (!alive) return;
        const name = err instanceof DOMException ? err.name : '';
        const tr = tRef.current;
        setError(name === 'NotAllowedError' ? tr('errors.camera_denied') : name === 'NotFoundError' ? tr('errors.no_camera') : tr('errors.device'));
      }
    };
    void acquire();
    stopTicker.current?.();
    stopTicker.current = createTicker(15, () => {
      if (meterRef.current) meterRef.current.style.transform = `scaleX(${audioLevel(analyser.current, levelBuf.current).toFixed(2)})`;
    });
    return () => {
      alive = false;
    };
  }, [phase, mode, camId, micId, noise, quality, usesCamera, supported]);

  // Reloj de la grabación (lo que se grabó, sin las pausas).
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const id = window.setInterval(() => {
      const ms = activeMs.current + (phase === 'recording' ? performance.now() - resumedAt.current : 0);
      // Lo sacado al volver atrás no cuenta en el reloj.
      setElapsed(Math.floor((usedRewind.current ? keptMs(keepRef.current) + Math.max(0, ms - segStart.current) : ms) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  // Desenfoque de fondo del navegador: se pide a la pista de la cámara.
  useEffect(() => {
    if (!blurOk) return;
    void setCameraBlur(camStream.current?.getVideoTracks()[0], blur);
  }, [blur, blurOk]);

  // La ventana flotante se cierra sola al terminar.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused' && floatWin) {
      floatWin.close();
      setFloatWin(null);
    }
  }, [phase, floatWin]);

  const currentActiveMs = () => activeMs.current + (recorder.current?.state === 'recording' ? performance.now() - resumedAt.current : 0);

  function previewSource(): HTMLCanvasElement | HTMLVideoElement | null {
    if (compositedRef.current) return canvasRef.current;
    if (mode === 'screen') return screenVideo.current;
    return camVideo.current;
  }

  function tick() {
    if (meterRef.current) meterRef.current.style.transform = `scaleX(${audioLevel(analyser.current, levelBuf.current).toFixed(2)})`;
    if (compositedRef.current) {
      const c = canvasRef.current;
      const g = c?.getContext('2d');
      const sv = screenVideo.current;
      const cam = camVideo.current;
      const now = performance.now();
      if (c && g && mode !== 'camera' && sv && sv.videoWidth) {
        g.drawImage(sv, 0, 0, c.width, c.height);
        const b = bubbleRef.current;
        if (mode === 'screen_camera' && cam && camStream.current) drawBubble(g, cam, b.x * c.width, b.y * c.height, b.d * c.height, lookRef.current);
      } else if (c && g && mode === 'camera' && cam && cam.videoWidth) {
        g.save();
        if ('filter' in g) g.filter = LOW_LIGHT_FILTER;
        g.drawImage(cam, 0, 0, c.width, c.height);
        g.restore();
      }
      if (c && g) {
        strokes.current = strokes.current.filter((st) => inkAlpha(st, now) > 0);
        drawInk(g, strokes.current, c.width, c.height, now);
        const pa = pointerAt.current;
        if (pa && toolRef.current === 'pointer') drawPointer(g, pa.x * c.width, pa.y * c.height, c.height);
      }
    }
    if (recorder.current?.state !== 'recording') return;
    const ms = currentActiveMs();
    const src = previewSource();
    if (!src) return;
    if (gifFrames.current.length < GIF_FRAMES && ms >= 500 && ms - lastGifAt.current >= GIF_EVERY_MS) {
      const shot = snapshot(src, GIF_WIDTH);
      const g = shot?.getContext('2d');
      if (shot && g && (!gifFrames.current[0] || (gifFrames.current[0].width === shot.width && gifFrames.current[0].height === shot.height))) {
        gifFrames.current.push({ width: shot.width, height: shot.height, rgba: g.getImageData(0, 0, shot.width, shot.height).data });
        lastGifAt.current = ms;
      }
    }
    if (!thumb.current && !thumbPending.current && ms >= 1000) {
      const shot = snapshot(src, 960);
      if (shot) {
        thumbPending.current = true;
        void canvasToBlob(shot, 'image/jpeg', 0.82).then((b) => {
          thumb.current = b;
          thumbPending.current = false;
        });
      }
    }
  }

  async function start() {
    setError(null);
    if (!supported) return;
    cancelled.current = false;
    if (usesScreen) {
      if (!screenSupported()) {
        setError(t('errors.screen_unsupported'));
        return;
      }
      try {
        const q = QUALITY[quality];
        const screen = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 }, width: { ideal: q.width }, height: { ideal: q.height } },
          audio: systemAudio,
          // Opciones de Chrome: dejar elegir pestaña, ventana o pantalla y traer el audio del sistema.
          ...({ selfBrowserSurface: 'include', surfaceSwitching: 'include', systemAudio: systemAudio ? 'include' : 'exclude' } as Record<string, string>),
        } as DisplayMediaStreamOptions);
        screenStream.current = screen;
        screen.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (recorder.current && recorder.current.state !== 'inactive') void stop();
        });
        if (screenVideo.current) {
          screenVideo.current.srcObject = screen;
          void screenVideo.current.play().catch(() => undefined);
        }
      } catch {
        setError(t('errors.screen_denied'));
        return;
      }
    }
    setCount(3);
    setPhase('countdown');
    const step = (n: number) => {
      if (n === 0) {
        countdownTimer.current = null;
        void begin();
        return;
      }
      setCount(n);
      countdownTimer.current = window.setTimeout(() => step(n - 1), 1000);
    };
    step(3);
  }

  function cancelCountdown() {
    if (countdownTimer.current) window.clearTimeout(countdownTimer.current);
    countdownTimer.current = null;
    stopTracks(screenStream.current);
    screenStream.current = null;
    setPhase('setup');
  }

  async function begin() {
    const q = QUALITY[quality];
    let videoTrack: MediaStreamTrack | undefined;
    let width = 0;
    let height = 0;
    if (composited) {
      const c = canvasRef.current;
      const settings = (mode === 'camera' ? camStream.current : screenStream.current)?.getVideoTracks()[0]?.getSettings() ?? {};
      let w = settings.width || 1280;
      let h = settings.height || 720;
      if (h > q.height) {
        w = Math.round((w * q.height) / h);
        h = q.height;
      }
      width = w - (w % 2);
      height = h - (h % 2);
      if (c) {
        c.width = width;
        c.height = height;
        videoTrack = c.captureStream(30).getVideoTracks()[0];
      }
    } else if (mode === 'screen') {
      videoTrack = screenStream.current?.getVideoTracks()[0];
      const s = videoTrack?.getSettings();
      width = s?.width ?? 0;
      height = s?.height ?? 0;
    } else {
      videoTrack = camStream.current?.getVideoTracks()[0];
      const s = videoTrack?.getSettings();
      width = s?.width ?? 0;
      height = s?.height ?? 0;
    }
    if (!videoTrack) {
      setError(t('errors.device'));
      releaseScreen();
      setPhase('setup');
      return;
    }
    const mixed = mixAudio([micStream.current, systemAudio ? screenStream.current : null]);
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = mixed.ctx;
    analyser.current = mixed.analyser;
    const tracks = [videoTrack, ...(mixed.track ? [mixed.track] : [])];
    const mime = pickVideoMime();
    mimeRef.current = mime;
    try {
      await sink?.begin({ mime, mode });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('errors.upload'));
      releaseScreen();
      setPhase('setup');
      return;
    }
    keepRef.current = [];
    segStart.current = 0;
    usedRewind.current = false;
    history.current = [];
    setRewound([]);
    strokes.current = [];
    chunks.current = [];
    audioChunks.current = [];
    gifFrames.current = [];
    lastGifAt.current = -Infinity;
    thumb.current = null;
    activeMs.current = 0;
    // Un keyframe cada 2 s (Chrome 125+): cada cluster WebM arranca decodificable y el recorte
    // puede cortar por clusters sin recodificar (lib/rec-webm.ts cutWebm).
    const rec = new MediaRecorder(new MediaStream(tracks), {
      mimeType: mime,
      videoBitsPerSecond: q.bitrate,
      audioBitsPerSecond: 128_000,
      ...({ videoKeyFrameIntervalDuration: 2000 } as Record<string, number>),
    });
    rec.ondataavailable = (e) => {
      if (!e.data.size || cancelled.current) return;
      if (sink) sink.chunk(e.data);
      else chunks.current.push(e.data);
    };
    recorder.current = rec;
    const audioMime = pickAudioMime();
    if (captureAudioTrack && mixed.track && audioMime) {
      const ar = new MediaRecorder(new MediaStream([mixed.track]), { mimeType: audioMime, audioBitsPerSecond: 32_000 });
      ar.ondataavailable = (e) => {
        if (e.data.size && !cancelled.current) audioChunks.current.push(e.data);
      };
      audioRecorder.current = ar;
      ar.start(1000);
    } else {
      audioRecorder.current = null;
    }
    stopTicker.current?.();
    stopTicker.current = createTicker(30, tick);
    rec.start(1000);
    resumedAt.current = performance.now();
    setElapsed(0);
    sizeRef.current = { width, height };
    setPhase('recording');
  }

  function releaseScreen() {
    stopTracks(screenStream.current);
    screenStream.current = null;
  }

  function pause() {
    const r = recorder.current;
    if (!r || r.state !== 'recording') return;
    r.pause();
    audioRecorder.current?.pause();
    activeMs.current += performance.now() - resumedAt.current;
    // El tramo que venía se cierra acá: volver atrás trabaja sobre lo cerrado.
    if (activeMs.current > segStart.current) keepRef.current = [...keepRef.current, [segStart.current, activeMs.current]];
    segStart.current = activeMs.current;
    setPhase('paused');
  }

  function back(seconds: number) {
    history.current.push(keepRef.current);
    keepRef.current = rewindKeep(keepRef.current, seconds * 1000);
    usedRewind.current = true;
    setRewound((r) => [...r, seconds]);
    setElapsed(Math.floor(keptMs(keepRef.current) / 1000));
  }

  function undoBack() {
    const prev = history.current.pop();
    if (!prev) return;
    keepRef.current = prev;
    setRewound((r) => r.slice(0, -1));
    if (!history.current.length) usedRewind.current = false;
    setElapsed(Math.floor(keptMs(keepRef.current) / 1000));
  }

  function resume() {
    const r = recorder.current;
    if (!r || r.state !== 'paused') return;
    r.resume();
    audioRecorder.current?.resume();
    resumedAt.current = performance.now();
    setPhase('recording');
    if (!usedRewind.current) return;
    // Después de volver atrás el corte tiene que caer en un keyframe: unos segundos de margen
    // antes de que la persona siga hablando, para que no se pierda nada de lo nuevo.
    segStart.current = activeMs.current;
    setLead(Math.ceil(REWIND_LEAD_MS / 1000));
    const started = performance.now();
    const step = () => {
      const left = REWIND_LEAD_MS - (performance.now() - started);
      if (left <= 0) {
        leadTimer.current = null;
        setLead(0);
        return;
      }
      setLead(Math.ceil(left / 1000));
      leadTimer.current = window.setTimeout(step, 200);
    };
    leadTimer.current = window.setTimeout(step, 200);
  }

  function stopRecorder(r: MediaRecorder | null): Promise<void> {
    return new Promise((resolve) => {
      if (!r || r.state === 'inactive') return resolve();
      r.addEventListener('stop', () => resolve(), { once: true });
      r.stop();
    });
  }

  async function stop() {
    const r = recorder.current;
    if (!r || r.state === 'inactive') return;
    if (r.state === 'recording') activeMs.current += performance.now() - resumedAt.current;
    if (activeMs.current > segStart.current) keepRef.current = [...keepRef.current, [segStart.current, activeMs.current]];
    segStart.current = activeMs.current;
    setPhase('finishing');
    if (!thumb.current) {
      const src = previewSource();
      const shot = src ? snapshot(src, 960) : null;
      thumb.current = shot ? await canvasToBlob(shot, 'image/jpeg', 0.82) : null;
    }
    await Promise.all([stopRecorder(r), stopRecorder(audioRecorder.current)]);
    stopTicker.current?.();
    stopTicker.current = null;
    const durationSec = Math.max(1, Math.round(activeMs.current / 100) / 10);
    const mime = mimeRef.current;
    const type = mime.split(';')[0] || 'video/webm';
    let blob: Blob | null = null;
    if (!sink) {
      blob = new Blob(chunks.current, { type });
      if (type === 'video/webm') {
        const patched = patchWebmDuration(new Uint8Array(await blob.arrayBuffer()), durationSec * 1000);
        blob = new Blob([patched as Uint8Array<ArrayBuffer>], { type });
      }
    }
    let gif: Blob | null = null;
    if (gifFrames.current.length >= 2) {
      try {
        gif = new Blob([encodeGif(gifFrames.current, GIF_EVERY_MS / 10) as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
      } catch {
        gif = null;
      }
    }
    const audioType = audioRecorder.current?.mimeType?.split(';')[0] || null;
    const audio = audioChunks.current.length && audioType ? new Blob(audioChunks.current, { type: audioType }) : null;
    releaseAll();
    recorder.current = null;
    audioRecorder.current = null;
    onDone({
      blob,
      mime: type,
      mode,
      durationSec,
      width: sizeRef.current.width,
      height: sizeRef.current.height,
      thumbnail: thumb.current,
      gif,
      audio,
      audioMime: audio ? audioType : null,
      keep: usedRewind.current ? keepRef.current : null,
    });
  }

  async function discard() {
    cancelled.current = true;
    await Promise.all([stopRecorder(recorder.current), stopRecorder(audioRecorder.current)]);
    recorder.current = null;
    audioRecorder.current = null;
    sink?.abort();
    stopTicker.current?.();
    stopTicker.current = null;
    releaseScreen();
    setPhase('setup');
  }

  // Mientras se graba: Alt+Shift+P pausa o sigue, Alt+Shift+S termina, Esc pide confirmar descartar.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') setConfirmDiscard(false);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.altKey && e.shiftKey && (k === 'p' || e.code === 'KeyP')) {
        e.preventDefault();
        if (phase === 'recording') pause();
        else resume();
      } else if (e.altKey && e.shiftKey && (k === 's' || e.code === 'KeyS')) {
        e.preventDefault();
        void stop();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmDiscard((c) => !c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Esc cancela la cuenta regresiva.
  useEffect(() => {
    if (phase !== 'countdown') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelCountdown();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ---------- Burbuja: arrastrar y agrandar ----------
  const drag = useRef<{ kind: 'move' | 'size'; startX: number; startY: number; orig: Bubble; w: number; h: number } | null>(null);

  function onBubbleDown(e: ReactPointerEvent<HTMLElement>, kind: 'move' | 'size') {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, startX: e.clientX, startY: e.clientY, orig: bubbleRef.current, w: stage.width, h: stage.height };
  }

  function onBubbleMove(e: ReactPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.w;
    const dy = (e.clientY - d.startY) / d.h;
    if (d.kind === 'move') setBubble(fitBubble({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }, d.w, d.h));
    else setBubble(fitBubble({ ...d.orig, d: d.orig.d + Math.max(dx * (d.w / d.h), dy) }, d.w, d.h));
  }

  function onBubbleUp() {
    drag.current = null;
  }

  function fitBubble(b: Bubble, w: number, h: number): Bubble {
    const dd = clamp(b.d, 0.12, 0.7);
    const halfW = (dd * h) / w / 2;
    return { d: dd, x: clamp(b.x, halfW, 1 - halfW), y: clamp(b.y, dd / 2, 1 - dd / 2) };
  }

  function onBubbleKey(e: ReactKeyboardEvent<HTMLElement>) {
    const stage = stageRef.current?.getBoundingClientRect();
    const w = stage?.width || 16;
    const h = stage?.height || 9;
    const b = bubbleRef.current;
    const step = 0.03;
    const map: Record<string, Partial<Bubble>> = {
      ArrowLeft: { x: b.x - step },
      ArrowRight: { x: b.x + step },
      ArrowUp: { y: b.y - step },
      ArrowDown: { y: b.y + step },
      '+': { d: b.d + 0.04 },
      '=': { d: b.d + 0.04 },
      '-': { d: b.d - 0.04 },
    };
    const patch = map[e.key];
    if (!patch) return;
    e.preventDefault();
    setBubble(fitBubble({ ...b, ...patch }, w, h));
  }

  const stageAspect = (() => {
    const c = canvasRef.current;
    return c && c.width && c.height ? c.width / c.height : 16 / 9;
  })();
  const bubbleStyle = {
    left: `${(bubble.x - (bubble.d / stageAspect) / 2) * 100}%`,
    top: `${(bubble.y - bubble.d / 2) * 100}%`,
    width: `${(bubble.d / stageAspect) * 100}%`,
  };

  const live = phase === 'recording' || phase === 'paused' || phase === 'finishing' || phase === 'countdown';
  const active = phase === 'recording' || phase === 'paused';
  const canBack = rewind && canRewind && mimeRef.current.startsWith('video/webm');

  // ---------- Lápiz y puntero sobre la vista previa ----------
  function stagePoint(e: ReactPointerEvent<HTMLElement>) {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  }

  function onInkDown(e: ReactPointerEvent<HTMLElement>) {
    const p = stagePoint(e);
    if (!p || tool !== 'pen') return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    strokes.current.push({ points: [p], color: inkColor, doneAt: null });
  }

  function onInkMove(e: ReactPointerEvent<HTMLElement>) {
    const p = stagePoint(e);
    if (!p) return;
    pointerAt.current = p;
    const cur = strokes.current[strokes.current.length - 1];
    if (tool === 'pen' && cur && cur.doneAt === null) cur.points.push(p);
  }

  function onInkUp() {
    const cur = strokes.current[strokes.current.length - 1];
    if (cur && cur.doneAt === null) cur.doneAt = performance.now();
  }

  async function floatControls() {
    if (floatWin) {
      floatWin.close();
      setFloatWin(null);
      return;
    }
    const win = await openFloatingWindow(360, notes.trim() ? 300 : 96).catch(() => null);
    if (!win) return;
    win.addEventListener('pagehide', () => setFloatWin(null), { once: true });
    setFloatWin(win);
  }

  const notesPanel = notes.trim() && showNotes && (
    <div className="rec-notes-live" data-testid="rec-notes-live">
      <p className="rec-notes-text">{notes}</p>
    </div>
  );

  // Los controles van en la barra o, si se pidió, en la ventana flotante.
  const mainControls = (
    <>
      {phase === 'recording' && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={pause} data-testid="rec-pause" aria-keyshortcuts="Alt+Shift+P" title={t('pauseHint')}>
          {t('pause')}
        </button>
      )}
      {phase === 'paused' && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={resume} data-testid="rec-resume">
          {t('resume')}
        </button>
      )}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => void stop()}
        disabled={phase === 'finishing'}
        data-testid="rec-stop"
        aria-keyshortcuts="Alt+Shift+S"
        title={t('stopHint')}
      >
        {t('stop')}
      </button>
    </>
  );

  if (!supported) {
    return (
      <div className="rec-recorder" data-testid="rec-recorder">
        <p className="ui-error" role="alert">
          {t('errors.unsupported')}
        </p>
      </div>
    );
  }

  return (
    <div className="rec-recorder" data-testid="rec-recorder" data-phase={phase}>
      {phase === 'setup' && (
        <div className="rec-setup">
          <fieldset className="rec-modes">
            <legend className="label">{t('modeLabel')}</legend>
            <div className="rec-mode-row" role="radiogroup" aria-label={t('modeLabel')}>
              {modes.map((m) => (
                <label key={m} className={`rec-mode${mode === m ? ' active' : ''}`}>
                  <input type="radio" name="rec-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                  <span>{t(`mode.${m}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="rec-devices">
            {usesCamera && (
              <div className="ui-field">
                <label className="label" htmlFor="rec-cam">
                  {t('camera')}
                </label>
                <select id="rec-cam" className="select" value={camId} onChange={(e) => setCamId(e.target.value)}>
                  <option value="">{t('defaultDevice')}</option>
                  {cams.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || t('cameraN', { n: i + 1 })}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="ui-field">
              <label className="label" htmlFor="rec-mic">
                {t('microphone')}
              </label>
              <select id="rec-mic" className="select" value={micId} onChange={(e) => setMicId(e.target.value)}>
                <option value="">{t('defaultDevice')}</option>
                {mics.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || t('micN', { n: i + 1 })}
                  </option>
                ))}
                <option value="none">{t('noMic')}</option>
              </select>
              {micId !== 'none' && (
                <span className="rec-meter" aria-hidden="true">
                  <span ref={meterRef} className="rec-meter-fill" />
                </span>
              )}
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="rec-quality">
                {t('quality')}
              </label>
              <select id="rec-quality" className="select" value={quality} onChange={(e) => setQuality(e.target.value as QualityKey)}>
                <option value="720">720p</option>
                <option value="1080">1080p</option>
                <option value="2160">4K</option>
              </select>
            </div>
          </div>
          <div className="rec-toggles">
            <label className="ui-check">
              <input type="checkbox" checked={noise} onChange={(e) => setNoise(e.target.checked)} />
              <span>{t('noise')}</span>
            </label>
            {usesScreen && (
              <label className="ui-check">
                <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />
                <span>{t('systemAudio')}</span>
              </label>
            )}
          </div>
          {usesCamera && (
            <fieldset className="rec-look" data-testid="rec-look">
              <legend className="label">{t('look')}</legend>
              <div className="rec-look-row">
                {mode === 'screen_camera' && (
                  <>
                    <div className="ui-field">
                      <label className="label" htmlFor="rec-shape">
                        {t('shape')}
                      </label>
                      <select id="rec-shape" className="select" value={shape} onChange={(e) => setShape(e.target.value as BubbleShape)} data-testid="rec-shape">
                        <option value="circle">{t('shapes.circle')}</option>
                        <option value="square">{t('shapes.square')}</option>
                      </select>
                    </div>
                    <div className="ui-field">
                      <label className="label" htmlFor="rec-frame">
                        {t('frame')}
                      </label>
                      <select id="rec-frame" className="select" value={frame} onChange={(e) => setFrame(e.target.value as BubbleFrame)} data-testid="rec-frame">
                        <option value="white">{t('frames.white')}</option>
                        <option value="dark">{t('frames.dark')}</option>
                        <option value="accent">{t('frames.accent')}</option>
                        <option value="none">{t('frames.none')}</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
              <div className="rec-toggles">
                <label className="ui-check">
                  <input type="checkbox" checked={lowLight} disabled={!filterOk} onChange={(e) => setLowLight(e.target.checked)} data-testid="rec-lowlight" />
                  <span>{t('lowLight')}</span>
                </label>
                <label className="ui-check">
                  <input type="checkbox" checked={blur} disabled={!blurOk} onChange={(e) => setBlur(e.target.checked)} data-testid="rec-blur" />
                  <span>{t('blur')}</span>
                </label>
              </div>
              {(!blurOk || !filterOk) && <p className="ui-help" data-testid="rec-look-note">{!blurOk ? t('blurNote') : t('filterNote')}</p>}
            </fieldset>
          )}
          {usesScreen && (
            <label className="ui-check">
              <input type="checkbox" checked={drawTools || mode === 'screen_camera'} disabled={mode === 'screen_camera'} onChange={(e) => setDrawTools(e.target.checked)} data-testid="rec-drawtools" />
              <span>{t('drawTools')}</span>
            </label>
          )}
          <div className="ui-field">
            <label className="label" htmlFor="rec-notes">
              {t('notes')}
            </label>
            <textarea id="rec-notes" className="textarea" rows={3} maxLength={20000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPlaceholder')} data-testid="rec-notes" />
            <p className="ui-help">{t('notesHelp')}</p>
          </div>
          <div className={`rec-setup-preview rec-setup-${mode}`}>
            {usesScreen && <p className="rec-setup-screen">{t('screenHint')}</p>}
          </div>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <div className="rec-actions">
            {onCancel && (
              <button type="button" className="btn btn-ghost" onClick={onCancel}>
                {t('cancel')}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => void start()} data-testid="rec-start">
              {t('start')}
            </button>
          </div>
        </div>
      )}

      {/* Videos fuente: la cámara se ve en la configuración y en solo cámara; la pantalla, en solo pantalla. */}
      <div className={`rec-stage-wrap${live ? ' live' : ''}`} hidden={phase === 'setup' && !usesCamera}>
        <div ref={stageRef} className={`rec-stage rec-stage-${mode}`}>
          <video
            ref={camVideo}
            className={`rec-cam${(mode === 'camera' && !(composited && live)) || phase === 'setup' ? '' : ' rec-offscreen'}${phase === 'setup' && mode === 'screen_camera' ? ` rec-cam-bubble rec-cam-${shape} rec-frame-${frame}` : ''}${phase === 'setup' && lowLight ? ' rec-cam-light' : ''}`}
            muted
            playsInline
            aria-label={t('cameraPreview')}
          />
          <video ref={screenVideo} className={`rec-screen${mode === 'screen' && !composited && live ? '' : ' rec-offscreen'}`} muted playsInline aria-hidden="true" />
          <canvas ref={canvasRef} className={`rec-canvas${composited && live ? '' : ' rec-offscreen'}`} aria-label={t('livePreview')} />
          {composited && active && tool !== 'none' && (
            <div className={`rec-ink-layer rec-ink-${tool}`} onPointerDown={onInkDown} onPointerMove={onInkMove} onPointerUp={onInkUp} onPointerLeave={() => (pointerAt.current = null)} data-testid="rec-ink-layer" />
          )}
          {mode === 'screen_camera' && live && (
            <div
              className={`rec-bubble-handle rec-cam-${shape}`}
              style={bubbleStyle}
              tabIndex={0}
              role="group"
              aria-label={t('bubbleHelp')}
              title={t('bubbleHelp')}
              onPointerDown={(e) => onBubbleDown(e, 'move')}
              onPointerMove={onBubbleMove}
              onPointerUp={onBubbleUp}
              onKeyDown={onBubbleKey}
              data-testid="rec-bubble"
            >
              <span
                className="rec-bubble-resize"
                aria-hidden="true"
                onPointerDown={(e) => onBubbleDown(e, 'size')}
                onPointerMove={onBubbleMove}
                onPointerUp={onBubbleUp}
              />
            </div>
          )}
          {phase === 'countdown' && (
            <button type="button" className="rec-countdown" onClick={cancelCountdown} aria-live="assertive" data-testid="rec-countdown">
              <span className="rec-countdown-n">{count}</span>
              <span className="rec-countdown-hint">{t('countdownHint')}</span>
            </button>
          )}
        </div>
      </div>

      {(phase === 'recording' || phase === 'paused' || phase === 'finishing') && (
        <div className="rec-bar" role="toolbar" aria-label={t('controls')}>
          <span className={`rec-dot${phase === 'paused' ? ' paused' : ''}`} aria-hidden="true" />
          <span className="rec-time data" role="timer" aria-live="off" data-testid="rec-time">
            {fmtClock(elapsed)}
          </span>
          <span className="rec-state" role="status">
            {phase === 'paused' ? t('paused') : phase === 'finishing' ? t('finishing') : t('recording')}
          </span>
          {micId !== 'none' && (
            <span className="rec-meter" aria-hidden="true">
              <span ref={meterRef} className="rec-meter-fill" />
            </span>
          )}
          {status && <span className="rec-upload-status">{status}</span>}
          <span className="rec-bar-spacer" />
          {confirmDiscard && phase !== 'finishing' && (
            <span className="rec-confirm" role="alertdialog" aria-label={t('discardConfirm')} data-testid="rec-discard-confirm">
              <span>{t('discardConfirm')}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDiscard(false)} autoFocus>
                {t('keepRecording')}
              </button>
              <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => void discard()}>
                {t('discard')}
              </button>
            </span>
          )}
          {!confirmDiscard && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDiscard(true)} disabled={phase === 'finishing'} data-testid="rec-discard">
              {t('discard')}
            </button>
          )}
          {floatWin ? <span className="rec-float-note muted">{t('floatOpen')}</span> : mainControls}
        </div>
      )}

      {active && (
        <div className="rec-tools" data-testid="rec-tools">
          {composited && (
            <div className="rec-tool-group" role="group" aria-label={t('drawGroup')}>
              <button type="button" className="btn btn-ghost btn-sm" aria-pressed={tool === 'pen'} onClick={() => setTool(tool === 'pen' ? 'none' : 'pen')} data-testid="rec-tool-pen">
                {t('pen')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" aria-pressed={tool === 'pointer'} onClick={() => setTool(tool === 'pointer' ? 'none' : 'pointer')} data-testid="rec-tool-pointer">
                {t('pointer')}
              </button>
              {tool === 'pen' &&
                INK_COLORS.map((c) => (
                  <button key={c} type="button" className="rec-ink-color" style={{ background: c }} aria-pressed={inkColor === c} aria-label={t(`inkColors.${c.slice(1)}`)} onClick={() => setInkColor(c)} />
                ))}
            </div>
          )}
          {notes.trim() && (
            <button type="button" className="btn btn-ghost btn-sm" aria-pressed={showNotes} onClick={() => setShowNotes((v) => !v)} data-testid="rec-notes-toggle">
              {t('notes')}
            </button>
          )}
          {floatOk ? (
            <button type="button" className="btn btn-ghost btn-sm" aria-pressed={!!floatWin} onClick={() => void floatControls()} data-testid="rec-float">
              {t('float')}
            </button>
          ) : (
            <span className="ui-help rec-float-note" data-testid="rec-float-off">
              {t('floatOff')}
            </span>
          )}
          {composited && tool !== 'none' && <span className="ui-help rec-float-note">{t('drawHelp')}</span>}
        </div>
      )}

      {phase === 'paused' && rewind && (
        <div className="rec-rewind" role="group" aria-label={t('rewind')} data-testid="rec-rewind">
          {canBack ? (
            <>
              <span className="label">{t('rewind')}</span>
              {[5, 15, 30].map((n) => (
                <button key={n} type="button" className="btn btn-secondary btn-sm" disabled={keptMs(keepRef.current) <= 0} onClick={() => back(n)} data-testid={`rec-back-${n}`}>
                  {t('rewindBack', { n })}
                </button>
              ))}
              {rewound.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={undoBack} data-testid="rec-back-undo">
                  {t('rewindUndo')}
                </button>
              )}
              <span className="ui-help">{t('rewindHelp')}</span>
            </>
          ) : (
            <span className="ui-help" data-testid="rec-rewind-off">
              {t('rewindOff')}
            </span>
          )}
        </div>
      )}
      {lead > 0 && (
        <p className="rec-lead" role="status" data-testid="rec-lead">
          {t('rewindLead', { n: lead })}
        </p>
      )}
      {active && !floatWin && notesPanel}
      {floatWin &&
        createPortal(
          <div className="rec-float" data-testid="rec-float-window">
            <div className="rec-float-bar">
              <span className={`rec-dot${phase === 'paused' ? ' paused' : ''}`} aria-hidden="true" />
              <span className="rec-time data">{fmtClock(elapsed)}</span>
              <span className="rec-bar-spacer" />
              {mainControls}
            </div>
            {lead > 0 && <p className="rec-lead">{t('rewindLead', { n: lead })}</p>}
            {notesPanel}
          </div>,
          floatWin.document.body,
        )}
    </div>
  );
}
