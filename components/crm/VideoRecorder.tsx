'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ContactPicker, { type PickedContact } from './ContactPicker';
import { uploadMedia } from './mediaUpload';

type Source = 'camera' | 'screen';
type Phase = 'pick' | 'live' | 'recording' | 'review' | 'saving';

function pickMime(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

/**
 * Grabar un video 1:1 en el navegador (como HubSpot Video / Vidyard): cámara
 * o pantalla con micrófono, vista previa, grabar y parar, revisar, y guardar
 * con título, contacto y mensaje. Se sube a Blob (o al disco en dev).
 */
export default function VideoRecorder({
  open,
  onClose,
  onSaved,
  direct,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  direct: boolean;
}) {
  const t = useTranslations('crm.media');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('pick');
  const [source, setSource] = useState<Source>('camera');
  const [elapsed, setElapsed] = useState(0);
  const [recorded, setRecorded] = useState<{ blob: Blob; url: string; seconds: number } | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [error, setError] = useState<string | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }

  function reset() {
    stopStream();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    if (recorded) URL.revokeObjectURL(recorded.url);
    setRecorded(null);
    setPhase('pick');
    setElapsed(0);
    setError(null);
  }

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - startedRef.current) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => () => stopStream(), []);

  async function startPreview() {
    setError(null);
    if (!navigator.mediaDevices || !pickMime()) {
      setError(t('errors.recorder_unsupported'));
      return;
    }
    try {
      let stream: MediaStream;
      if (source === 'camera') {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
      } else {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        stream = new MediaStream([...screen.getVideoTracks(), ...(mic?.getAudioTracks() ?? [])]);
        // Si la persona corta el compartir desde el navegador, se para la grabación.
        screen.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        });
      }
      streamRef.current = stream;
      setPhase('live');
      requestAnimationFrame(() => {
        if (liveRef.current) {
          liveRef.current.srcObject = stream;
          void liveRef.current.play().catch(() => undefined);
        }
      });
    } catch {
      setError(t('errors.recorder_denied'));
      stopStream();
      setPhase('pick');
    }
  }

  function record() {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = pickMime();
    chunksRef.current = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime.split(';')[0] || 'video/webm' });
      const seconds = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
      stopStream();
      setRecorded({ blob, url: URL.createObjectURL(blob), seconds });
      setPhase('review');
    };
    recorderRef.current = rec;
    startedRef.current = Date.now();
    setElapsed(0);
    rec.start(1000);
    setPhase('recording');
  }

  async function save() {
    if (!recorded) return;
    setPhase('saving');
    setError(null);
    const ext = recorded.blob.type.includes('mp4') ? 'mp4' : 'webm';
    const res = await uploadMedia<{ id: string }>({
      kind: 'video',
      file: recorded.blob,
      filename: `${(title.trim() || 'video').replace(/[^\w-]+/g, '-').slice(0, 60)}.${ext}`,
      direct,
      fields: { title: title.trim() || t('untitledVideo'), message, contactId: contact?.id ?? null, durationSec: recorded.seconds },
    });
    if (!res.ok) {
      setError(t.has(`errors.${res.code}`) ? t(`errors.${res.code}`) : t('errors.generic'));
      setPhase('review');
      return;
    }
    reset();
    setTitle('');
    setMessage('');
    setContact(null);
    onSaved(res.row.id);
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <dialog
      ref={dialogRef}
      className="ui-modal ui-modal-wide"
      aria-labelledby="vr-title"
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <div className="ui-modal-head">
        <h2 className="ui-modal-title" id="vr-title">
          {t('recordTitle')}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => dialogRef.current?.close()}>
          {t('cancel')}
        </button>
      </div>
      <div className="ui-modal-body vr">
        {phase === 'pick' && (
          <>
            <fieldset className="vr-sources">
              <legend className="label">{t('recordSource')}</legend>
              {(['camera', 'screen'] as const).map((s) => (
                <label key={s} className="ui-check">
                  <input type="radio" name="vr-source" checked={source === s} onChange={() => setSource(s)} />
                  <span>{t(`source.${s}`)}</span>
                </label>
              ))}
            </fieldset>
            <p className="ui-help">{t('recordHelp')}</p>
          </>
        )}
        {(phase === 'live' || phase === 'recording') && (
          <div className="vr-stage">
            <video ref={liveRef} className="vr-video" muted playsInline aria-label={t('livePreview')} />
            {phase === 'recording' && (
              <span className="vr-rec" role="status">
                {t('recordingFor', { time: mmss(elapsed) })}
              </span>
            )}
          </div>
        )}
        {(phase === 'review' || phase === 'saving') && recorded && (
          <div className="vr-review">
            <video className="vr-video" src={recorded.url} controls playsInline aria-label={t('reviewPreview')} />
            <div className="ui-field">
              <label className="label" htmlFor="vr-name">
                {t('videoTitle')}
              </label>
              <input id="vr-name" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </div>
            <ContactPicker value={contact} onChange={setContact} label={t('forContact')} />
            <div className="ui-field">
              <label className="label" htmlFor="vr-msg">
                {t('message')}
              </label>
              <textarea id="vr-msg" className="textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
            </div>
          </div>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="ui-modal-foot">
        {phase === 'pick' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={startPreview}>
            {t(`start.${source}`)}
          </button>
        )}
        {phase === 'live' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={record}>
            {t('startRecording')}
          </button>
        )}
        {phase === 'recording' && (
          <button type="button" className="btn btn-primary btn-danger btn-sm" onClick={() => recorderRef.current?.stop()}>
            {t('stopRecording')}
          </button>
        )}
        {(phase === 'review' || phase === 'saving') && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={phase === 'saving'}>
              {t('reRecord')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} aria-busy={phase === 'saving' || undefined} disabled={phase === 'saving'}>
              {phase === 'saving' ? t('uploading') : t('saveVideo')}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
