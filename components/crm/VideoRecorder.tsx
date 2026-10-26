'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ContactPicker, { type PickedContact } from './ContactPicker';
import { uploadMedia } from './mediaUpload';
import Recorder, { type RecordingResult } from '@/components/rec/Recorder';

type Phase = 'record' | 'review' | 'saving';

/**
 * Grabar un video 1:1 en el navegador (como HubSpot Video / Vidyard) con el
 * grabador de Rec (components/rec/Recorder): cámara, pantalla o pantalla con
 * la cámara en una burbuja, micrófono a elección, pausa y cuenta regresiva.
 * Después se revisa y se guarda con título, contacto y mensaje. Se sube a
 * Blob (o al disco en dev).
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
  const [phase, setPhase] = useState<Phase>('record');
  const [recorded, setRecorded] = useState<{ blob: Blob; url: string; seconds: number } | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Remonta el grabador al volver a abrir o al regrabar (suelta cámara y micrófono).
  const [session, setSession] = useState(0);

  function reset() {
    if (recorded) URL.revokeObjectURL(recorded.url);
    setRecorded(null);
    setPhase('record');
    setError(null);
    setSession((n) => n + 1);
  }

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function onRecorded(r: RecordingResult) {
    if (!r.blob) return;
    setRecorded({ blob: r.blob, url: URL.createObjectURL(r.blob), seconds: Math.max(1, Math.round(r.durationSec)) });
    setPhase('review');
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
        {open && phase === 'record' && (
          <>
            <p className="ui-help">{t('recordHelp')}</p>
            <Recorder key={session} modes={['camera', 'screen', 'screen_camera']} onDone={onRecorded} />
          </>
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
      {(phase === 'review' || phase === 'saving') && (
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={phase === 'saving'}>
            {t('reRecord')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} aria-busy={phase === 'saving' || undefined} disabled={phase === 'saving'}>
            {phase === 'saving' ? t('uploading') : t('saveVideo')}
          </button>
        </div>
      )}
    </dialog>
  );
}
