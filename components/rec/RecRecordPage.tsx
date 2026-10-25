'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { defaultTitle, type RecMode } from '@/lib/rec-schema';
import Recorder, { type RecorderSink, type RecordingResult } from './Recorder';
import { LiveUpload, uploadAsset, uploadWhole } from './liveUpload';
import { copyToClipboard } from './RecCopy';
import { notifyRecChanged } from './RecDialogs';

type Stage = 'record' | 'saving' | 'error';

/**
 * Grabar un video nuevo: el grabador sube por partes mientras se graba y al
 * cortar cierra la subida, sube el audio (para la transcripción), la
 * miniatura y el GIF, copia el link y abre el video.
 */
export default function RecRecordPage({ folderId, space, baseUrl, transcriptionOn }: { folderId: string | null; space: 'personal' | 'workspace'; baseUrl: string; transcriptionOn: boolean }) {
  const t = useTranslations('rec.record');
  const tc = useTranslations('rec.common');
  const locale = useLocale();
  const router = useRouter();
  const upload = useRef<LiveUpload | null>(null);
  const video = useRef<{ id: string; shareId: string; partBytes: number; mode: 'blob' | 'local' } | null>(null);
  const [stage, setStage] = useState<Stage>('record');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const errorText = useCallback((code: string) => (tc.has(`errors.${code}`) ? tc(`errors.${code}`) : tc('errors.generic')), [tc]);

  const sink = useMemo<RecorderSink>(
    () => ({
      begin: async ({ mime, mode }: { mime: string; mode: RecMode }) => {
        const res = await fetch('/api/rec/videos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: defaultTitle(t('defaultTitle'), new Date(), locale), mode, contentType: mime.split(';')[0], folderId, space }),
        }).catch(() => null);
        if (!res?.ok) {
          const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'generic';
          throw new Error(errorText(code));
        }
        const data = (await res.json()) as { video: { id: string; shareId: string }; upload: { mode: 'blob' | 'local'; partBytes: number } };
        video.current = { id: data.video.id, shareId: data.video.shareId, partBytes: data.upload.partBytes, mode: data.upload.mode };
        const up = new LiveUpload(data.video.id, data.upload.mode, data.upload.partBytes, mime);
        try {
          await up.start();
        } catch (err) {
          void fetch(`/api/rec/videos/${data.video.id}`, { method: 'DELETE' }).catch(() => undefined);
          throw new Error(errorText(err instanceof Error ? err.message : 'upload_failed'));
        }
        upload.current = up;
        setRecording(true);
      },
      chunk: (data: Blob) => upload.current?.push(data),
      abort: () => {
        upload.current?.abort();
        upload.current = null;
        setRecording(false);
        const v = video.current;
        video.current = null;
        if (v) void fetch(`/api/rec/videos/${v.id}`, { method: 'DELETE' }).catch(() => undefined);
      },
    }),
    [folderId, space, locale, t, errorText],
  );

  // No cerrar la pestaña a mitad de una grabación o subida.
  useEffect(() => {
    if (!recording && stage !== 'saving') return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [recording, stage]);

  useEffect(() => {
    if (stage !== 'saving') return;
    const id = window.setInterval(() => {
      const up = upload.current;
      if (up && up.pushedBytes) setProgress(Math.min(99, Math.round((up.uploadedBytes / up.pushedBytes) * 100)));
    }, 400);
    return () => window.clearInterval(id);
  }, [stage]);

  async function onDone(r: RecordingResult) {
    const up = upload.current;
    const v = video.current;
    if (!up || !v) return;
    setStage('saving');
    setError(null);
    try {
      await up.finish(r.durationSec * 1000);
      if (r.audio) await uploadWhole(v.id, 'audio', r.audio, v.mode, v.partBytes).catch(() => undefined);
      if (r.thumbnail) await uploadAsset(v.id, 'thumb', r.thumbnail).catch(() => undefined);
      if (r.gif) await uploadAsset(v.id, 'gif', r.gif).catch(() => undefined);
      const res = await fetch(`/api/rec/videos/${v.id}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ durationSec: r.durationSec, width: r.width, height: r.height }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'upload_failed');
      setProgress(100);
      setRecording(false);
      const copied = await copyToClipboard(`${baseUrl}/${locale}/v/${v.shareId}`);
      notifyRecChanged();
      upload.current = null;
      router.push(`/app/rec/${v.id}?created=${copied ? 'copied' : '1'}`);
    } catch (err) {
      setStage('error');
      setRecording(false);
      setError(errorText(err instanceof Error ? err.message : 'upload_failed'));
    }
  }

  const back = folderId ? `/app/rec/f/${folderId}` : space === 'workspace' ? '/app/rec/workspace' : '/app/rec';

  return (
    <div className="app-page ui-page rec-record-page" data-testid="rec-record-page">
      <PageHeader title={t('title')} description={t('desc')} back={{ href: back, label: t('back') }} />
      {!transcriptionOn && <p className="ui-help rec-note">{t('noTranscription')}</p>}
      {stage === 'record' && <Recorder sink={sink} captureAudioTrack onDone={(r) => void onDone(r)} onCancel={() => router.push(back)} />}
      {stage === 'saving' && (
        <div className="rec-saving" role="status" aria-live="polite" data-testid="rec-saving">
          <p>{t('saving')}</p>
          <progress max={100} value={progress} aria-label={t('saving')} />
        </div>
      )}
      {stage === 'error' && (
        <div className="rec-saving">
          <p className="ui-error" role="alert">
            {error}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => setStage('record')}>
            {t('tryAgain')}
          </button>
        </div>
      )}
    </div>
  );
}
