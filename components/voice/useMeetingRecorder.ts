'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChunkRecorder, getMic, getTabAudio, mediaErrorCode, postWithRetry, stopStream, type AudioChunk } from './audio';
import { VOICE_CHUNK_MS, type VoiceSegment, type VoiceSource } from '@/lib/voice-types';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping';
export type CaptureMode = 'mic' | 'mic_tab';

/** Errores con los que no tiene sentido seguir grabando. */
const FATAL = new Set(['ai_disabled', 'transcribe_disabled', 'quota_exceeded', 'not_found']);
/** Pico mínimo para subir un trozo (más bajo = silencio, no se transcribe). */
const SILENCE_PEAK = 0.012;

/**
 * Graba una reunión: micrófono solo (fuente "mixed", con hablantes si el
 * proveedor los separa) o micrófono + audio de una pestaña ("me" y "them",
 * como "Yo" y "Ellos" de Granola). Cada trozo de ~20 s se sube y vuelve
 * transcrito; `onSegments` los va sumando a la transcripción en vivo.
 */
export function useMeetingRecorder(opts: {
  sessionId: string;
  baseOffsetMs: number;
  onSegments: (segs: VoiceSegment[]) => void;
  onStatus: (status: 'recording' | 'done') => void;
}) {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [tabLive, setTabLive] = useState(false);
  const recsRef = useRef<Array<{ rec: ChunkRecorder; source: VoiceSource }>>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0Ref = useRef(0);
  const baseRef = useRef(opts.baseOffsetMs);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const stateRef = useRef<RecorderState>('idle');
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const set = (s: RecorderState) => {
    stateRef.current = s;
    setState(s);
  };

  useEffect(() => {
    // Solo crece: un trozo nuevo nunca reusa el número (seq) de uno anterior.
    if (stateRef.current === 'idle') baseRef.current = Math.max(baseRef.current, opts.baseOffsetMs);
  }, [opts.baseOffsetMs]);

  const upload = useCallback((source: VoiceSource, chunk: AudioChunk, startedAtBase: number) => {
    if (chunk.peak < SILENCE_PEAK) return;
    const offsetMs = startedAtBase + chunk.startMs;
    const seq = Math.round(offsetMs / 100);
    setPending((n) => n + 1);
    queueRef.current = queueRef.current.then(async () => {
      const res = await postWithRetry(`/api/voice/sessions/${optsRef.current.sessionId}/chunks`, () => {
        const form = new FormData();
        form.append('audio', chunk.blob, `chunk.${chunk.blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
        form.append('source', source);
        form.append('seq', String(seq));
        form.append('offsetMs', String(offsetMs));
        form.append('durationMs', String(chunk.durationMs));
        return form;
      });
      setPending((n) => n - 1);
      const data = (await res?.json().catch(() => null)) as { segments?: VoiceSegment[]; error?: string } | null;
      if (!res?.ok) {
        const code = data?.error ?? 'network';
        setError(code);
        if (FATAL.has(code) && stateRef.current === 'recording') void stopRef.current();
        return;
      }
      if (data?.segments?.length) optsRef.current.onSegments(data.segments);
    });
  }, []);

  const stop = useCallback(async () => {
    if (stateRef.current !== 'recording') return;
    set('stopping');
    if (tickRef.current) clearInterval(tickRef.current);
    await Promise.all(recsRef.current.map((r) => r.rec.stop()));
    recsRef.current = [];
    streamsRef.current.forEach(stopStream);
    streamsRef.current = [];
    setTabLive(false);
    setLevel(0);
    await queueRef.current;
    baseRef.current += Date.now() - t0Ref.current;
    optsRef.current.onStatus('done');
    set('idle');
  }, []);
  stopRef.current = stop;

  const start = useCallback(
    async (mode: CaptureMode) => {
      if (stateRef.current !== 'idle') return;
      setError(null);
      set('starting');
      const streams: MediaStream[] = [];
      try {
        const mic = await getMic();
        streams.push(mic);
        let tab: MediaStream | null = null;
        if (mode === 'mic_tab') {
          tab = await getTabAudio();
          streams.push(tab);
        }
        streamsRef.current = streams;
        const base = baseRef.current;
        // Los e2e acortan los trozos con window.__zsVoiceChunkMs.
        const chunkMs = Number((window as unknown as { __zsVoiceChunkMs?: number }).__zsVoiceChunkMs) || VOICE_CHUNK_MS;
        const micRec = new ChunkRecorder(mic, chunkMs, (c) => upload(tab ? 'me' : 'mixed', c, base));
        recsRef.current = [{ rec: micRec, source: tab ? 'me' : 'mixed' }];
        if (tab) {
          const tabRec = new ChunkRecorder(tab, chunkMs, (c) => upload('them', c, base));
          recsRef.current.push({ rec: tabRec, source: 'them' });
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
        optsRef.current.onStatus('recording');
        set('recording');
      } catch (err) {
        streams.forEach(stopStream);
        set('idle');
        setError(mediaErrorCode(err));
      }
    },
    [upload],
  );

  // Cerrar la pestaña o salir de la página corta la grabación.
  useEffect(
    () => () => {
      if (tickRef.current) clearInterval(tickRef.current);
      recsRef.current.forEach((r) => void r.rec.stop());
      streamsRef.current.forEach(stopStream);
    },
    [],
  );

  return { state, error, setError, pending, elapsed, level, tabLive, start, stop };
}
