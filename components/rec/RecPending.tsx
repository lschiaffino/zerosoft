'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { LiveUpload, finishRecording, type UploadStatus } from './liveUpload';
import { forget, listMetas, localRecording, saveFile, type RecPendingMeta } from './recStore';
import { notifyRecChanged } from './RecDialogs';

/**
 * Grabaciones guardadas en este navegador que no terminaron de subirse
 * (corte de red, pestaña cerrada): reanudar, descargar o descartar.
 */
export default function RecPending() {
  const t = useTranslations('rec.pending');
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<RecPendingMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listMetas().then((m) => {
      if (alive) setItems(m.filter((x) => x.next > 1).sort((a, b) => b.createdAt - a.createdAt));
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!items.length) return null;

  async function resume(m: RecPendingMeta) {
    setBusy(m.videoId);
    setError(null);
    try {
      const up = await LiveUpload.resume(m.videoId);
      if (!up) throw new Error('missing');
      if (!up.info.done) {
        // Se cortó grabando: se cierra con lo que hay.
        await up.seal({ durationMs: up.info.durationMs ?? 0, width: 0, height: 0, audio: null, thumb: null, gif: null });
      }
      await finishRecording(up, setStatus);
      notifyRecChanged();
      router.push(`/app/rec/${m.videoId}`);
    } catch {
      setError(t('error'));
      setBusy(null);
    }
  }

  async function discard(m: RecPendingMeta) {
    await forget(m.videoId);
    void fetch(`/api/rec/videos/${m.videoId}`, { method: 'DELETE' }).catch(() => undefined);
    setItems((prev) => prev.filter((x) => x.videoId !== m.videoId));
  }

  const date = (ms: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));

  return (
    <section className="rec-pending" aria-label={t('title')} data-testid="rec-pending">
      <h2 className="rec-h">{t('title')}</h2>
      <p className="ui-help">{t('body')}</p>
      <ul className="rec-pending-list">
        {items.map((m) => (
          <li key={m.videoId} className="rec-pending-row">
            <span className="rec-pending-name">
              {m.title} <span className="muted data">· {date(m.createdAt)} · {(m.bytes / (1024 * 1024)).toFixed(1)} MB</span>
            </span>
            <span className="rec-pending-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => void resume(m)} data-testid="rec-pending-resume">
                {busy === m.videoId ? t('resuming', { pct: status && status.totalBytes ? Math.round((status.uploadedBytes / status.totalBytes) * 100) : 0 }) : t('resume')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={async () => saveFile(await localRecording(m), `${m.title}.webm`)}>
                {t('download')}
              </button>
              <button type="button" className="btn btn-ghost btn-danger btn-sm" disabled={busy !== null} onClick={() => void discard(m)}>
                {t('discard')}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
