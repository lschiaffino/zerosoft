'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { defaultTitle, type RecMode } from '@/lib/rec-schema';
import Recorder, { type RecorderSink, type RecordingResult } from './Recorder';
import { LiveUpload, finishRecording, type UploadStatus } from './liveUpload';
import { localRecording, saveFile } from './recStore';
import { copyToClipboard } from './RecCopy';
import { notifyRecChanged } from './RecDialogs';
import RecPending from './RecPending';

type Stage = 'record' | 'saving' | 'error';

const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);

/** Texto corto del estado de la subida y de la red (barra del grabador y pantalla de cierre). */
export function useUploadLabel() {
  const t = useTranslations('rec.record');
  return useCallback(
    (s: UploadStatus | null) => {
      if (!s) return '';
      if (s.state === 'offline') return t('statusOffline', { mb: mb(s.pendingBytes) });
      if (s.state === 'waiting') return t('statusRetry', { mb: mb(s.pendingBytes) });
      if (s.pendingParts > 0) return t('statusUploading', { mb: mb(s.pendingBytes) });
      return t('statusSynced');
    },
    [t],
  );
}

/**
 * Grabar un video nuevo. Cada parte se guarda en el navegador y se sube
 * mientras se graba; si se corta la red, sigue grabando y lo guarda local, y
 * sube todo al volver. Al terminar espera lo pendiente (con avance), sube el
 * audio, la miniatura y el GIF, copia el link y abre el video. Si no hay red,
 * se puede descargar la grabación o dejarla para después (se recupera al
 * volver a abrir Rec en este navegador).
 */
export default function RecRecordPage({ folderId, space, baseUrl, transcriptionOn }: { folderId: string | null; space: 'personal' | 'workspace'; baseUrl: string; transcriptionOn: boolean }) {
  const t = useTranslations('rec.record');
  const tc = useTranslations('rec.common');
  const locale = useLocale();
  const router = useRouter();
  const label = useUploadLabel();
  const upload = useRef<LiveUpload | null>(null);
  const [stage, setStage] = useState<Stage>('record');
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const errorText = useCallback((code: string) => (tc.has(`errors.${code}`) ? tc(`errors.${code}`) : tc('errors.generic')), [tc]);

  const sink = useMemo<RecorderSink>(
    () => ({
      begin: async ({ mime, mode }: { mime: string; mode: RecMode }) => {
        const title = defaultTitle(t('defaultTitle'), new Date(), locale);
        const res = await fetch('/api/rec/videos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, mode, contentType: mime.split(';')[0], folderId, space }),
        }).catch(() => null);
        if (!res?.ok) {
          const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? (res ? 'generic' : 'offline_start');
          throw new Error(errorText(code));
        }
        const data = (await res.json()) as { video: { id: string; shareId: string }; upload: { mode: 'blob' | 'local'; partBytes: number } };
        try {
          const up = await LiveUpload.create({ videoId: data.video.id, shareId: data.video.shareId, title, mode: data.upload.mode, partBytes: data.upload.partBytes, contentType: mime });
          up.onStatus(setStatus);
          upload.current = up;
        } catch (err) {
          void fetch(`/api/rec/videos/${data.video.id}`, { method: 'DELETE' }).catch(() => undefined);
          throw new Error(errorText(err instanceof Error ? err.message : 'upload_failed'));
        }
        setRecording(true);
      },
      chunk: (data: Blob) => upload.current?.push(data),
      abort: () => {
        const up = upload.current;
        upload.current = null;
        setRecording(false);
        setStatus(null);
        if (up) {
          up.abort();
          void fetch(`/api/rec/videos/${up.videoId}`, { method: 'DELETE' }).catch(() => undefined);
        }
      },
    }),
    [folderId, space, locale, t, errorText],
  );

  // No cerrar la pestaña a mitad de una grabación o de una subida.
  useEffect(() => {
    if (!recording && stage !== 'saving') return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [recording, stage]);

  async function onDone(r: RecordingResult) {
    const up = upload.current;
    if (!up) return;
    setStage('saving');
    setError(null);
    try {
      await up.seal({ durationMs: r.durationSec * 1000, width: r.width, height: r.height, audio: r.audio, thumb: r.thumbnail, gif: r.gif });
      await finishRecording(up, setStatus);
      setRecording(false);
      const copied = await copyToClipboard(`${baseUrl}/${locale}/v/${up.info.shareId}`);
      notifyRecChanged();
      upload.current = null;
      router.push(`/app/rec/${up.videoId}?created=${copied ? 'copied' : '1'}`);
    } catch (err) {
      setStage('error');
      setRecording(false);
      setError(errorText(err instanceof Error ? err.message : 'upload_failed'));
    }
  }

  async function downloadLocal() {
    const up = upload.current;
    if (!up) return;
    saveFile(await localRecording(up.info), `${up.info.title.replace(/[\\/:*?"<>|]+/g, ' ')}.webm`);
  }

  const back = folderId ? `/app/rec/f/${folderId}` : space === 'workspace' ? '/app/rec/workspace' : '/app/rec';
  const pct = status && status.totalBytes ? Math.min(99, Math.round((status.uploadedBytes / status.totalBytes) * 100)) : 0;

  return (
    <div className="app-page ui-page rec-record-page" data-testid="rec-record-page">
      <PageHeader title={t('title')} description={t('desc')} back={{ href: back, label: t('back') }} />
      {!transcriptionOn && <p className="ui-help rec-note">{t('noTranscription')}</p>}
      {stage === 'record' && <RecPending />}
      {stage === 'record' && (
        <Recorder
          sink={sink}
          captureAudioTrack
          onDone={(r) => void onDone(r)}
          onCancel={() => router.push(back)}
          status={
            recording && status ? (
              <span className={`rec-net ${status.state}`} data-testid="rec-upload-status" role="status">
                {label(status)}
              </span>
            ) : null
          }
        />
      )}
      {stage === 'saving' && (
        <div className="rec-saving" role="status" aria-live="polite" data-testid="rec-saving">
          <p>{status?.state === 'offline' ? t('savingOffline') : t('saving')}</p>
          <progress max={100} value={pct} aria-label={t('saving')} />
          {status && <p className="ui-help" data-testid="rec-saving-status">{label(status)}</p>}
          {status && (status.state === 'offline' || status.state === 'waiting') && (
            <div className="rec-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void downloadLocal()} data-testid="rec-download-local">
                {t('downloadLocal')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => router.push(back)}>
                {t('later')}
              </button>
            </div>
          )}
        </div>
      )}
      {stage === 'error' && (
        <div className="rec-saving">
          <p className="ui-error" role="alert">
            {error}
          </p>
          <div className="rec-actions">
            {upload.current && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void downloadLocal()}>
                {t('downloadLocal')}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setStage('record')}>
              {t('tryAgain')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
