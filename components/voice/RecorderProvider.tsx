'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { ChunkRecorder, getMic, getTabAudio, mediaErrorCode, postUntilDone, stopStream, type AudioChunk } from './audio';
import { formatDuration, VOICE_CHUNK_MS, type VoiceSegment, type VoiceSource } from '@/lib/voice-types';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping';
export type CaptureMode = 'mic' | 'mic_tab';

/** Errores con los que no tiene sentido seguir grabando. */
const FATAL = new Set(['ai_disabled', 'transcribe_disabled', 'quota_exceeded', 'not_found']);
/** Pico mínimo para subir un trozo (más bajo = silencio, no se transcribe). */
const SILENCE_PEAK = 0.012;
/** Con tantos trozos esperando, se avisa que la transcripción viene atrasada. */
const LAG_PENDING = 3;

type SegmentsListener = (segs: VoiceSegment[]) => void;
type DoneListener = () => void;

export interface RecorderApi {
  /** Reunión que se está grabando (o la última que se grabó, hasta que termina de cerrarse). */
  sessionId: string | null;
  state: RecorderState;
  error: string | null;
  setError: (e: string | null) => void;
  pending: number;
  /** La transcripción va atrasada (trozos en cola o esperando el rate limit). */
  lagging: boolean;
  elapsed: number;
  level: number;
  tabLive: boolean;
  mode: CaptureMode;
  start: (args: { sessionId: string; mode: CaptureMode; baseOffsetMs: number }) => Promise<void>;
  stop: () => Promise<void>;
  /** Escuchar los segmentos nuevos y el cierre de una reunión. */
  subscribe: (sessionId: string, onSegments: SegmentsListener, onDone?: DoneListener) => () => void;
}

const RecorderContext = createContext<RecorderApi | null>(null);

export function useRecorder(): RecorderApi {
  const ctx = useContext(RecorderContext);
  if (!ctx) throw new Error('RecorderProvider missing');
  return ctx;
}

/**
 * Grabador de reuniones de toda la app (montado en el layout de /app, como el
 * dictado): la grabación sigue al navegar dentro de zerosoft y un indicador
 * discreto en la barra de arriba (punto rojo, tiempo y Terminar) lleva a la
 * reunión. Micrófono solo (fuente "mixed") o micrófono + pestaña ("me" y
 * "them"). Cada trozo de ~20 s se sube con reintentos (respeta Retry-After y
 * nunca descarta un trozo por un error pasajero). Al cerrar la pestaña avisa
 * y, si igual se cierra, cierra la sesión con sendBeacon; la nota con IA
 * queda en cola en el servidor.
 */
export default function RecorderProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('voice.recorder');
  const pathname = usePathname();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [tabLive, setTabLive] = useState(false);
  const [mode, setMode] = useState<CaptureMode>('mic');
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const recsRef = useRef<Array<{ rec: ChunkRecorder; source: VoiceSource }>>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0Ref = useRef(0);
  const baseRef = useRef(0);
  const stateRef = useRef<RecorderState>('idle');
  const sessionRef = useRef<string | null>(null);
  const segListeners = useRef(new Map<string, Set<SegmentsListener>>());
  const doneListeners = useRef(new Map<string, Set<DoneListener>>());
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const set = (s: RecorderState) => {
    stateRef.current = s;
    setState(s);
  };

  // El indicador va en el hueco de la barra de arriba (AppSidebar › #band-voice-slot).
  useEffect(() => {
    setSlot(document.getElementById('band-voice-slot'));
  }, [pathname]);

  const subscribe = useCallback((id: string, onSegments: SegmentsListener, onDone?: DoneListener) => {
    const segs = segListeners.current.get(id) ?? new Set();
    segs.add(onSegments);
    segListeners.current.set(id, segs);
    const dones = doneListeners.current.get(id) ?? new Set();
    if (onDone) dones.add(onDone);
    doneListeners.current.set(id, dones);
    return () => {
      segs.delete(onSegments);
      if (onDone) dones.delete(onDone);
    };
  }, []);

  const upload = useCallback((id: string, source: VoiceSource, chunk: AudioChunk, startedAtBase: number) => {
    if (chunk.peak < SILENCE_PEAK) return;
    const offsetMs = startedAtBase + chunk.startMs;
    const seq = Math.round(offsetMs / 100);
    setPending((n) => n + 1);
    queueRef.current = queueRef.current.then(async () => {
      const res = await postUntilDone(
        `/api/voice/sessions/${id}/chunks`,
        () => {
          const form = new FormData();
          form.append('audio', chunk.blob, `chunk.${chunk.blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
          form.append('source', source);
          form.append('seq', String(seq));
          form.append('offsetMs', String(offsetMs));
          form.append('durationMs', String(chunk.durationMs));
          return form;
        },
        { onWait: () => setWaiting(true) },
      );
      setWaiting(false);
      setPending((n) => n - 1);
      const data = (await res?.json().catch(() => null)) as { segments?: VoiceSegment[]; error?: string } | null;
      if (!res?.ok) {
        const code = data?.error ?? 'network';
        setError(code);
        if (FATAL.has(code) && stateRef.current === 'recording') void stopRef.current();
        return;
      }
      if (data?.segments?.length) segListeners.current.get(id)?.forEach((fn) => fn(data.segments!));
    });
  }, []);

  const teardown = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamsRef.current.forEach(stopStream);
    streamsRef.current = [];
    setTabLive(false);
    setLevel(0);
  }, []);

  const stop = useCallback(async () => {
    if (stateRef.current !== 'recording') return;
    const id = sessionRef.current;
    set('stopping');
    if (tickRef.current) clearInterval(tickRef.current);
    await Promise.all(recsRef.current.map((r) => r.rec.stop()));
    recsRef.current = [];
    teardown();
    await queueRef.current;
    baseRef.current += Date.now() - t0Ref.current;
    if (id) {
      // Cierra la sesión y deja la nota con IA en cola (el servidor la arma aunque se navegue).
      await fetch(`/api/voice/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'done', queueNotes: true }),
        keepalive: true,
      }).catch(() => null);
      doneListeners.current.get(id)?.forEach((fn) => fn());
    }
    set('idle');
  }, [teardown]);
  stopRef.current = stop;

  const start = useCallback(
    async (args: { sessionId: string; mode: CaptureMode; baseOffsetMs: number }) => {
      if (stateRef.current !== 'idle') return;
      setError(null);
      set('starting');
      setMode(args.mode);
      const streams: MediaStream[] = [];
      try {
        const mic = await getMic();
        streams.push(mic);
        let tab: MediaStream | null = null;
        if (args.mode === 'mic_tab') {
          tab = await getTabAudio();
          streams.push(tab);
        }
        streamsRef.current = streams;
        // Solo crece: un trozo nuevo nunca reusa el número (seq) de uno anterior de la misma reunión.
        baseRef.current = sessionRef.current === args.sessionId ? Math.max(baseRef.current, args.baseOffsetMs) : args.baseOffsetMs;
        sessionRef.current = args.sessionId;
        setSessionId(args.sessionId);
        const id = args.sessionId;
        const base = baseRef.current;
        // Los e2e acortan los trozos con window.__zsVoiceChunkMs.
        const chunkMs = Number((window as unknown as { __zsVoiceChunkMs?: number }).__zsVoiceChunkMs) || VOICE_CHUNK_MS;
        const micSource: VoiceSource = tab ? 'me' : 'mixed';
        recsRef.current = [{ rec: new ChunkRecorder(mic, chunkMs, (c) => upload(id, micSource, c, base)), source: micSource }];
        if (tab) {
          recsRef.current.push({ rec: new ChunkRecorder(tab, chunkMs, (c) => upload(id, 'them', c, base)), source: 'them' });
          setTabLive(true);
          // Si se deja de compartir la pestaña, se sigue con el micrófono.
          tab.getAudioTracks()[0]?.addEventListener('ended', () => setTabLive(false));
        }
        recsRef.current.forEach((r) => r.rec.start());
        t0Ref.current = Date.now();
        setElapsed(base);
        tickRef.current = setInterval(() => {
          setElapsed(base + Date.now() - t0Ref.current);
          setLevel(Math.max(...recsRef.current.map((r) => r.rec.level())));
        }, 200);
        await fetch(`/api/voice/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'recording', capture: args.mode }),
        }).catch(() => null);
        set('recording');
      } catch (err) {
        streams.forEach(stopStream);
        set('idle');
        setError(mediaErrorCode(err));
      }
    },
    [upload],
  );

  // Cerrar la pestaña con una grabación en curso: el navegador pregunta, y si se
  // cierra igual, la sesión se cierra con sendBeacon (la nota queda en cola).
  useEffect(() => {
    if (state !== 'recording' && state !== 'stopping') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onPageHide = () => {
      const id = sessionRef.current;
      if (id && navigator.sendBeacon) navigator.sendBeacon(`/api/voice/sessions/${id}/close`);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [state]);

  // Si el grabador se desmonta (se sale de la app) con una grabación en curso: cortar y cerrar.
  useEffect(
    () => () => {
      if (stateRef.current !== 'recording') return;
      recsRef.current.forEach((r) => void r.rec.stop());
      streamsRef.current.forEach(stopStream);
      if (tickRef.current) clearInterval(tickRef.current);
      const id = sessionRef.current;
      if (id) void fetch(`/api/voice/sessions/${id}/close`, { method: 'POST', keepalive: true }).catch(() => null);
    },
    [],
  );

  const api = useMemo<RecorderApi>(
    () => ({ sessionId, state, error, setError, pending, lagging: waiting || pending >= LAG_PENDING, elapsed, level, tabLive, mode, start, stop, subscribe }),
    [sessionId, state, error, pending, waiting, elapsed, level, tabLive, mode, start, stop, subscribe],
  );

  const recording = state === 'recording' || state === 'stopping';
  const onOwnPage = !!sessionId && pathname === `/app/voice/meetings/${sessionId}`;
  const indicator =
    recording && sessionId && !onOwnPage && slot
      ? createPortal(
          <span className="vc-rec-indicator" role="status">
            <Link href={`/app/voice/meetings/${sessionId}`} className="vc-rec-indicator-link" title={t('openMeeting')}>
              <span className="vc-rec-dot" aria-hidden="true" />
              <span className="data" role="timer">
                {formatDuration(elapsed)}
              </span>
              <span className="sr-only">{t('recordingLabel')}</span>
            </Link>
            <button type="button" className="vc-rec-indicator-stop" disabled={state === 'stopping'} onClick={() => void stop()}>
              {state === 'stopping' ? t('stopping') : t('stop')}
            </button>
          </span>,
          slot,
        )
      : null;

  return (
    <RecorderContext.Provider value={api}>
      {children}
      {indicator}
    </RecorderContext.Provider>
  );
}
