'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getMic, LevelMeter, mediaErrorCode, SimpleRecorder, stopStream } from './audio';
import { VOICE_DICTATION_MAX_MS, type VoiceSessionSummary } from '@/lib/voice-types';

export type DictationState = 'idle' | 'starting' | 'recording' | 'transcribing';

export interface DictationResult {
  text: string;
  raw: string;
  ai: boolean;
  aiError: string | null;
  session: VoiceSessionSummary;
}

/**
 * Grabar → /api/voice/dictate → texto limpio. `stop()` devuelve el resultado
 * (o null si se canceló o falló; el error queda en `error`).
 */
export function useDictation() {
  const [state, setState] = useState<DictationState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<SimpleRecorder | null>(null);
  const meterRef = useRef<LevelMeter | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0Ref = useRef(0);
  const stateRef = useRef<DictationState>('idle');
  const autoStopRef = useRef<(() => void) | null>(null);

  const set = (s: DictationState) => {
    stateRef.current = s;
    setState(s);
  };

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    meterRef.current?.close();
    meterRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async (): Promise<boolean> => {
    if (stateRef.current !== 'idle') return false;
    setError(null);
    set('starting');
    try {
      const stream = await getMic();
      // Se soltó la tecla (o se canceló) mientras se pedía el permiso.
      if ((stateRef.current as DictationState) !== 'starting') {
        stopStream(stream);
        return false;
      }
      streamRef.current = stream;
      meterRef.current = new LevelMeter(stream);
      recRef.current = new SimpleRecorder(stream);
      recRef.current.start();
      t0Ref.current = Date.now();
      setElapsed(0);
      tickRef.current = setInterval(() => {
        setLevel(meterRef.current?.level() ?? 0);
        const ms = Date.now() - t0Ref.current;
        setElapsed(ms);
        if (ms >= VOICE_DICTATION_MAX_MS) autoStopRef.current?.();
      }, 120);
      set('recording');
      return true;
    } catch (err) {
      cleanup();
      set('idle');
      setError(mediaErrorCode(err));
      return false;
    }
  }, [cleanup]);

  const cancel = useCallback(() => {
    if (stateRef.current === 'starting') {
      set('idle');
      return;
    }
    if (stateRef.current !== 'recording') return;
    void recRef.current?.stop();
    recRef.current = null;
    cleanup();
    set('idle');
  }, [cleanup]);

  const stop = useCallback(
    async (opts: { context: string; sourceApp: string }): Promise<DictationResult | null> => {
      if (stateRef.current === 'starting') {
        set('idle');
        return null;
      }
      if (stateRef.current !== 'recording' || !recRef.current) return null;
      const rec = recRef.current;
      recRef.current = null;
      set('transcribing');
      const { blob, durationMs } = await rec.stop();
      cleanup();
      if (durationMs < 300 || !blob.size) {
        set('idle');
        setError('too_short');
        return null;
      }
      const form = new FormData();
      form.append('audio', blob, `dictation.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
      form.append('context', opts.context);
      form.append('sourceApp', opts.sourceApp);
      form.append('durationMs', String(durationMs));
      const res = await fetch('/api/voice/dictate', { method: 'POST', body: form }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as (DictationResult & { error?: string }) | null;
      set('idle');
      if (!res?.ok || !data || data.error) {
        setError(data?.error ?? 'network');
        return null;
      }
      if (!data.text) {
        setError('nothing_heard');
        return null;
      }
      return data;
    },
    [cleanup],
  );

  return { state, error, setError, level, elapsed, start, stop, cancel, autoStopRef };
}
