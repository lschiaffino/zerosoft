'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { ChunkRecorder, getMic, getTabAudio, mediaErrorCode, stopStream, type AudioChunk } from './audio';
import { formatDuration, VOICE_CHUNK_MS, type VoiceSegment, type VoiceSource } from '@/lib/voice-types';
import { chunkKey, deleteFailedChunk, loadFailedChunks, saveFailedChunk } from './failedStore';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping';
export type CaptureMode = 'mic' | 'mic_tab';

/** Errores con los que no tiene sentido seguir grabando. */
const FATAL = new Set(['ai_disabled', 'transcribe_disabled', 'quota_exceeded', 'not_found', 'not_recorder']);
/** Pico mínimo para subir un trozo (más bajo = silencio, no se transcribe). */
const SILENCE_PEAK = 0.012;
/** Trozos más cortos que esto no se mandan. */
const MIN_CHUNK_MS = 100;
/** Con tantos trozos esperando, se avisa que la transcripción viene atrasada. */
const LAG_PENDING = 3;
/** Reintentos de un trozo que falla en la transcripción (5xx u otros 4xx); 429 y red se reintentan siempre. */
const MAX_FAILED_ATTEMPTS = 3;
/** Terminar espera como mucho esto a que se suban los trozos pendientes; lo que queda pasa a reintentar. */
const STOP_WAIT_MS = 20_000;
const HEARTBEAT_MS = 30_000;

type SegmentsListener = (segs: VoiceSegment[]) => void;
type DoneListener = () => void;

interface Job {
  sessionId: string;
  source: VoiceSource;
  seq: number;
  offsetMs: number;
  durationMs: number;
  blob: Blob;
  attempts: number;
  /** Vino de "Reintentar" (si sale bien, la reunión puede regenerar su nota). */
  retry?: boolean;
}

export interface RecorderApi {
  /** Reunión que se está grabando en esta pestaña (o la última). */
  sessionId: string | null;
  /** Id de esta pestaña como grabador (claim de la grabación en el servidor). */
  recorderId: string;
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
  /** Trozos que no se pudieron transcribir, por reunión (se pueden reintentar). */
  failed: Record<string, number>;
  /** Trozos recuperados con Reintentar, por reunión (para sugerir regenerar la nota). */
  recovered: Record<string, number>;
  retryFailed: (sessionId: string) => void;
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

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

/**
 * Grabador de reuniones de toda la app (montado en el layout de /app, como el
 * dictado): la grabación sigue al navegar dentro de zerosoft y un indicador
 * discreto en la barra de arriba lleva a la reunión. Micrófono solo (fuente
 * "mixed") o micrófono + pestaña ("me" y "them").
 *
 * Trozos: una cola en serie. 429 y red caída se reintentan hasta que pasan
 * (respetando Retry-After); un trozo que la transcripción rechaza (5xx u otro
 * 4xx) se reintenta unas pocas veces y pasa a "no se pudo transcribir" para
 * reintentarlo después desde la reunión, sin trabar a los siguientes.
 * Terminar espera como mucho 20 s y cierra igual.
 *
 * Una sola pestaña graba cada reunión: claim en el servidor al empezar y un
 * latido cada 30 s (también le dice al cron que la reunión sigue viva).
 */
export default function RecorderProvider({ children, owner }: { children: ReactNode; /** persona:workspace (separa los trozos guardados). */ owner: string }) {
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
  const [failed, setFailed] = useState<Record<string, number>>({});
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recovered, setRecovered] = useState<Record<string, number>>({});
  const menuRef = useRef<HTMLSpanElement>(null);
  const compactRef = useRef<HTMLButtonElement>(null);
  // Id de esta pestaña como grabador: sobrevive a una recarga (sessionStorage), así
  // la pestaña que recarga no se ve a sí misma como "otra pestaña grabando".
  const recorderIdRef = useRef('');
  if (!recorderIdRef.current) {
    let id = '';
    try {
      id = sessionStorage.getItem('zs-voice-recorder') ?? '';
    } catch {
      /* sin storage */
    }
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r-${Date.now()}-${Math.random()}`;
      try {
        sessionStorage.setItem('zs-voice-recorder', id);
      } catch {
        /* sin storage */
      }
    }
    recorderIdRef.current = id;
  }
  const recsRef = useRef<Array<{ rec: ChunkRecorder; source: VoiceSource }>>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const queueRef = useRef<Job[]>([]);
  const failedRef = useRef(new Map<string, Job[]>());
  const pumpingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const idleWaiters = useRef<Array<() => void>>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0Ref = useRef(0);
  const baseRef = useRef(0);
  const stateRef = useRef<RecorderState>('idle');
  const sessionRef = useRef<string | null>(null);
  const segListeners = useRef(new Map<string, Set<SegmentsListener>>());
  const doneListeners = useRef(new Map<string, Set<DoneListener>>());
  const stopRef = useRef<(opts?: { local?: boolean }) => Promise<void>>(async () => {});

  const set = (s: RecorderState) => {
    stateRef.current = s;
    setState(s);
  };

  // El indicador va en el hueco de la barra de arriba (AppSidebar › #band-voice-slot).
  // (El menú no se cierra con el cambio de ruta: apps como Talk reescriben la URL con
  // history.replaceState y lo cerrarían en la mano; lo cierran Esc, un clic afuera o sus ítems.)
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

  const syncCounts = useCallback(() => {
    setPending(queueRef.current.length + (pumpingRef.current ? 1 : 0));
    const counts: Record<string, number> = {};
    for (const [id, jobs] of failedRef.current) if (jobs.length) counts[id] = jobs.length;
    setFailed(counts);
  }, []);

  const markFailed = useCallback(
    (job: Job) => {
      const list = failedRef.current.get(job.sessionId) ?? [];
      if (!list.some((j) => j.source === job.source && j.seq === job.seq)) list.push(job);
      failedRef.current.set(job.sessionId, list);
      syncCounts();
      // Persistente: sobrevive a recargar la página.
      void saveFailedChunk({ key: chunkKey(owner, job), owner, sessionId: job.sessionId, source: job.source, seq: job.seq, offsetMs: job.offsetMs, durationMs: job.durationMs, blob: job.blob });
    },
    [syncCounts, owner],
  );

  // Trozos que quedaron sin transcribir en una visita anterior (de esta persona y workspace).
  useEffect(() => {
    let alive = true;
    void loadFailedChunks(owner).then((rows) => {
      if (!alive || !rows.length) return;
      for (const r of rows) {
        const list = failedRef.current.get(r.sessionId) ?? [];
        if (!list.some((j) => j.source === r.source && j.seq === r.seq)) {
          list.push({ sessionId: r.sessionId, source: r.source, seq: r.seq, offsetMs: r.offsetMs, durationMs: r.durationMs, blob: r.blob, attempts: 0 });
        }
        failedRef.current.set(r.sessionId, list);
      }
      syncCounts();
    });
    return () => {
      alive = false;
    };
  }, [owner, syncCounts]);

  /** Sube un trozo. 'done' | 'failed' | 'fatal:<code>' | 'aborted'. */
  const send = useCallback(async (job: Job, signal: AbortSignal): Promise<string> => {
    for (;;) {
      if (signal.aborted) return 'aborted';
      let res: Response | null = null;
      try {
        const form = new FormData();
        form.append('audio', job.blob, `chunk.${job.blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
        form.append('source', job.source);
        form.append('seq', String(job.seq));
        form.append('offsetMs', String(job.offsetMs));
        form.append('durationMs', String(job.durationMs));
        form.append('recorderId', recorderIdRef.current);
        res = await fetch(`/api/voice/sessions/${job.sessionId}/chunks`, { method: 'POST', body: form, signal });
      } catch {
        if (signal.aborted) return 'aborted';
        res = null;
      }
      if (res?.ok) {
        setWaiting(false);
        const data = (await res.json().catch(() => null)) as { segments?: VoiceSegment[] } | null;
        if (data?.segments?.length) segListeners.current.get(job.sessionId)?.forEach((fn) => fn(data.segments!));
        return 'done';
      }
      const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? (res ? `http_${res.status}` : 'network');
      if (res && FATAL.has(code)) return `fatal:${code}`;
      // Red caída o rate limit: se espera y se vuelve a intentar, sin límite.
      if (!res || res.status === 429) {
        setWaiting(true);
        const retryAfter = Number(res?.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000, signal);
        continue;
      }
      // La transcripción rechazó el trozo: unos pocos reintentos y después queda para reintentar a mano.
      job.attempts += 1;
      if (job.attempts >= MAX_FAILED_ATTEMPTS) return 'failed';
      await sleep(1500 * job.attempts, signal);
    }
  }, []);

  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    while (queueRef.current.length && !ctrl.signal.aborted) {
      const job = queueRef.current.shift()!;
      syncCounts();
      const result = await send(job, ctrl.signal);
      if (result === 'done') {
        void deleteFailedChunk(chunkKey(owner, job));
        if (job.retry) setRecovered((r) => ({ ...r, [job.sessionId]: (r[job.sessionId] ?? 0) + 1 }));
      }
      if (result === 'aborted') {
        queueRef.current.unshift(job);
        break;
      }
      if (result === 'failed') {
        markFailed(job);
        setError('chunks_failed');
      } else if (result.startsWith('fatal:')) {
        markFailed(job);
        const code = result.slice(6);
        setError(code === 'not_recorder' ? 'recording_elsewhere' : code);
        if (stateRef.current === 'recording') void stopRef.current({ local: code === 'not_recorder' });
      }
    }
    pumpingRef.current = false;
    setWaiting(false);
    syncCounts();
    if (!queueRef.current.length) idleWaiters.current.splice(0).forEach((fn) => fn());
  }, [send, syncCounts, markFailed, owner]);

  const enqueue = useCallback(
    (id: string, source: VoiceSource, chunk: AudioChunk, startedAtBase: number) => {
      if (chunk.peak < SILENCE_PEAK || chunk.durationMs < MIN_CHUNK_MS || !chunk.blob.size) return;
      const offsetMs = startedAtBase + chunk.startMs;
      queueRef.current.push({ sessionId: id, source, seq: Math.round(offsetMs / 100), offsetMs, durationMs: chunk.durationMs, blob: chunk.blob, attempts: 0 });
      syncCounts();
      void pump();
    },
    [pump, syncCounts],
  );

  const retryFailed = useCallback(
    (id: string) => {
      const jobs = failedRef.current.get(id) ?? [];
      failedRef.current.delete(id);
      for (const j of jobs) queueRef.current.push({ ...j, attempts: 0, retry: true });
      setError(null);
      syncCounts();
      void pump();
    },
    [pump, syncCounts],
  );

  /** Espera a que la cola se vacíe, como mucho `ms`. true = se vació. */
  const waitIdle = useCallback((ms: number) => {
    if (!queueRef.current.length && !pumpingRef.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      idleWaiters.current.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }, []);

  const teardown = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (beatRef.current) clearInterval(beatRef.current);
    tickRef.current = null;
    beatRef.current = null;
    streamsRef.current.forEach(stopStream);
    streamsRef.current = [];
    setTabLive(false);
    setLevel(0);
  }, []);

  /**
   * Terminar: corta los grabadores, espera hasta 20 s a que suban los trozos
   * (lo que no llegó queda para reintentar) y cierra la sesión dejando la nota
   * en cola. Con `local` (otra pestaña tomó la grabación) solo corta acá.
   */
  const stop = useCallback(
    async (opts: { local?: boolean } = {}) => {
      if (stateRef.current !== 'recording') return;
      const id = sessionRef.current;
      set('stopping');
      setMenuOpen(false);
      if (tickRef.current) clearInterval(tickRef.current);
      await Promise.all(recsRef.current.map((r) => r.rec.stop()));
      recsRef.current = [];
      teardown();
      baseRef.current += Date.now() - t0Ref.current;
      if (!(await waitIdle(STOP_WAIT_MS))) {
        abortRef.current?.abort();
        await waitIdle(2000);
        // Lo que quedó en la cola de esta reunión pasa a "no se pudo transcribir".
        const rest = queueRef.current.filter((j) => j.sessionId === id);
        queueRef.current = queueRef.current.filter((j) => j.sessionId !== id);
        rest.forEach((j) => markFailed(j));
        if (rest.length) setError('chunks_failed');
        if (queueRef.current.length) void pump();
      }
      if (id && !opts.local) {
        await fetch(`/api/voice/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'done', queueNotes: true }),
          keepalive: true,
        }).catch(() => null);
      }
      if (id) doneListeners.current.get(id)?.forEach((fn) => fn());
      set('idle');
    },
    [teardown, waitIdle, markFailed, pump],
  );
  stopRef.current = stop;

  const start = useCallback(
    async (args: { sessionId: string; mode: CaptureMode; baseOffsetMs: number }) => {
      if (stateRef.current !== 'idle') return;
      setError(null);
      set('starting');
      setMode(args.mode);
      const id = args.sessionId;
      // Claim de la grabación: si otra pestaña o dispositivo graba esta reunión, no se empieza.
      const claim = await fetch(`/api/voice/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'recording', capture: args.mode, recorderId: recorderIdRef.current }),
      }).catch(() => null);
      if (!claim?.ok) {
        const code = ((await claim?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'network';
        set('idle');
        setError(code);
        return;
      }
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
        baseRef.current = sessionRef.current === id ? Math.max(baseRef.current, args.baseOffsetMs) : args.baseOffsetMs;
        sessionRef.current = id;
        setSessionId(id);
        const base = baseRef.current;
        // Los e2e acortan los trozos con window.__zsVoiceChunkMs.
        const chunkMs = Number((window as unknown as { __zsVoiceChunkMs?: number }).__zsVoiceChunkMs) || VOICE_CHUNK_MS;
        const micSource: VoiceSource = tab ? 'me' : 'mixed';
        recsRef.current = [{ rec: new ChunkRecorder(mic, chunkMs, (c) => enqueue(id, micSource, c, base)), source: micSource }];
        if (tab) {
          recsRef.current.push({ rec: new ChunkRecorder(tab, chunkMs, (c) => enqueue(id, 'them', c, base)), source: 'them' });
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
        // Latido: mantiene el claim y le avisa al cron que la reunión sigue viva aunque haya silencio.
        const beatMs = Number((window as unknown as { __zsVoiceHeartbeatMs?: number }).__zsVoiceHeartbeatMs) || HEARTBEAT_MS;
        beatRef.current = setInterval(async () => {
          const res = await fetch(`/api/voice/sessions/${id}/heartbeat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recorderId: recorderIdRef.current }),
          }).catch(() => null);
          if (res?.status === 409 && stateRef.current === 'recording') {
            setError('recording_elsewhere');
            void stopRef.current({ local: true });
          }
        }, beatMs);
        set('recording');
      } catch (err) {
        streams.forEach(stopStream);
        // Se suelta el claim: la reunión vuelve a estar libre.
        await fetch(`/api/voice/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'done', queueNotes: false }),
        }).catch(() => null);
        set('idle');
        setError(mediaErrorCode(err));
      }
    },
    [enqueue],
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
      if (beatRef.current) clearInterval(beatRef.current);
      const id = sessionRef.current;
      if (id) void fetch(`/api/voice/sessions/${id}/close`, { method: 'POST', keepalive: true }).catch(() => null);
    },
    [],
  );

  const api = useMemo<RecorderApi>(
    () => ({
      sessionId,
      recorderId: recorderIdRef.current,
      state,
      error,
      setError,
      pending,
      lagging: waiting || pending >= LAG_PENDING,
      elapsed,
      level,
      tabLive,
      mode,
      failed,
      recovered,
      retryFailed,
      start,
      stop: () => stop(),
      subscribe,
    }),
    [sessionId, state, error, pending, waiting, elapsed, level, tabLive, mode, failed, recovered, retryFailed, start, stop, subscribe],
  );

  // Menú compacto: Esc o un clic afuera lo cierran y el foco vuelve al disparador.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (refocus: boolean) => {
      setMenuOpen(false);
      if (refocus) compactRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || compactRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [menuOpen]);

  const recording = state === 'recording' || state === 'stopping';
  const onOwnPage = !!sessionId && pathname === `/app/voice/meetings/${sessionId}`;
  const indicator =
    recording && sessionId && !onOwnPage && slot
      ? createPortal(
          <span className="vc-rec-indicator" role="status">
            {/* Ancho: link a la reunión + Terminar. Angosto: solo punto y tiempo; el toque abre Abrir / Terminar. */}
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
            <button
              ref={compactRef}
              type="button"
              className="vc-rec-indicator-compact"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('recordingLabel')}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span className="vc-rec-dot" aria-hidden="true" />
              <span className="data">{formatDuration(elapsed)}</span>
            </button>
            {menuOpen && (
              <span ref={menuRef} className="vc-rec-indicator-menu" role="menu">
                <Link href={`/app/voice/meetings/${sessionId}`} role="menuitem" onClick={() => setMenuOpen(false)}>
                  {t('openMeeting')}
                </Link>
                <button type="button" role="menuitem" disabled={state === 'stopping'} onClick={() => void stop()}>
                  {state === 'stopping' ? t('stopping') : t('stop')}
                </button>
              </span>
            )}
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
