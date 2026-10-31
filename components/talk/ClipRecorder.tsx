'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CLIP_AUDIO_BPS, CLIP_MAX_BYTES, CLIP_VIDEO_BPS, clipFileName, clipMaxSeconds, pickClipMime, type ClipKind } from '@/lib/talk-clips';
import { Modal } from './Dialogs';

type Phase = 'idle' | 'starting' | 'recording' | 'review';

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Graba un clip corto de audio o video en el navegador y lo devuelve como
 * archivo para adjuntar. Los topes de duración y bitrate lo dejan por debajo
 * del límite de 4,5 MB por pedido de Vercel, y se corta antes si llega a
 * CLIP_MAX_BYTES.
 */
export default function ClipRecorder({ onClose, onDone }: { onClose: () => void; onDone: (file: File) => void }) {
  const t = useTranslations('talk');
  const [phase, setPhase] = useState<Phase>('idle');
  const [kind, setKind] = useState<ClipKind>('audio');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ file: File; url: string } | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const unmounted = useRef(false);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  function stopTracks() {
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  // Al cerrar: fuera el micrófono, la cámara y la vista previa.
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      const r = recorder.current;
      if (r) r.ondataavailable = r.onstop = null;
      if (r && r.state !== 'inactive') r.stop();
      stopTracks();
    };
  }, []);
  // Al volver a elegir (al abrir, tras un error o para grabar de nuevo) el foco queda en la primera opción.
  useEffect(() => {
    if (phase === 'idle') firstChoice.current?.focus();
  }, [phase]);
  const resultUrl = result?.url;
  useEffect(() => () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  }, [resultUrl]);

  async function start(next: ClipKind) {
    const mime = pickClipMime(next, (m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      setError(t('clips.unsupported'));
      return;
    }
    setKind(next);
    setError(null);
    setResult(null);
    setSeconds(0);
    setPhase('starting');
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia(
        next === 'video' ? { audio: true, video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 24 } } } : { audio: true },
      );
    } catch {
      if (unmounted.current) return;
      setPhase('idle');
      setError(next === 'video' ? t('clips.noCamera') : t('clips.noMic'));
      return;
    }
    // Se cerró mientras el navegador pedía el permiso: nada queda prendido.
    if (unmounted.current) {
      media.getTracks().forEach((tr) => tr.stop());
      return;
    }
    stream.current = media;
    if (next === 'video' && preview.current) preview.current.srcObject = media;
    const chunks: Blob[] = [];
    let size = 0;
    const rec = new MediaRecorder(media, { mimeType: mime, audioBitsPerSecond: CLIP_AUDIO_BPS, ...(next === 'video' ? { videoBitsPerSecond: CLIP_VIDEO_BPS } : {}) });
    recorder.current = rec;
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      size += e.data.size;
      if (size >= CLIP_MAX_BYTES && rec.state === 'recording') rec.stop();
    };
    rec.onstop = () => {
      stopTracks();
      const base = mime.split(';')[0];
      const blob = new Blob(chunks, { type: base });
      if (!blob.size) {
        setPhase('idle');
        setError(t('clips.empty'));
        return;
      }
      const file = new File([blob], clipFileName(base), { type: base });
      setResult({ file, url: URL.createObjectURL(file) });
      setPhase('review');
    };
    rec.start(1000);
    const startedAt = Date.now();
    const max = clipMaxSeconds(next);
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(s);
      if (s >= max && rec.state === 'recording') rec.stop();
    }, 250);
    setPhase('recording');
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  return (
    <Modal
      title={t('clips.title')}
      onClose={onClose}
      foot={
        phase === 'review' && result ? (
          <>
            <button type="button" className="btn btn-sm" onClick={() => setPhase('idle')}>
              {t('clips.retake')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" autoFocus onClick={() => onDone(result.file)} data-testid="talk-clip-attach">
              {t('clips.attach')}
            </button>
          </>
        ) : phase === 'recording' ? (
          <button type="button" className="btn btn-primary btn-sm" autoFocus onClick={stop} data-testid="talk-clip-stop">
            {t('clips.stop')}
          </button>
        ) : (
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
        )
      }
    >
      <div className="talk-clip" data-testid="talk-clip-dialog">
        {!supported && <p className="ui-error" role="alert">{t('clips.unsupported')}</p>}
        {supported && (phase === 'idle' || phase === 'starting') && (
          <>
            <p className="talk-muted">{t('clips.help', { audio: clipMaxSeconds('audio') / 60, video: clipMaxSeconds('video') })}</p>
            <div className="talk-clip-choices">
              <button ref={firstChoice} type="button" className="btn btn-sm" disabled={phase === 'starting'} onClick={() => void start('audio')} data-testid="talk-clip-audio">
                {t('clips.recordAudio')}
              </button>
              <button type="button" className="btn btn-sm" disabled={phase === 'starting'} onClick={() => void start('video')} data-testid="talk-clip-video">
                {t('clips.recordVideo')}
              </button>
            </div>
          </>
        )}
        {/* Vista previa en vivo: montada también al arrancar para tener el elemento a mano. */}
        <video ref={preview} className="talk-clip-preview" autoPlay muted playsInline hidden={!(kind === 'video' && (phase === 'starting' || phase === 'recording'))} />
        {phase === 'recording' && (
          <p className="talk-clip-time" role="status" data-testid="talk-clip-time">
            {t('clips.recording', { elapsed: clock(seconds), max: clock(clipMaxSeconds(kind)) })}
          </p>
        )}
        {phase === 'review' && result && (kind === 'video' ? <video className="talk-clip-preview" src={result.url} controls playsInline /> : <audio className="talk-clip-audio" src={result.url} controls />)}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
