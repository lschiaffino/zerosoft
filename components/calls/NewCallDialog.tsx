'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { api, CallsDialog, uploadRecording, useErrorText } from './ui';

/**
 * Llamada nueva: mandar el bot ya a un link de Google Meet, o subir una
 * grabación (audio o video) para transcribirla y analizarla.
 */
export default function NewCallDialog({ open, onClose, botConfigured }: { open: boolean; onClose: () => void; botConfigured: boolean }) {
  const t = useTranslations('calls.new');
  const err = useErrorText();
  const router = useRouter();
  const [tab, setTab] = useState<'meet' | 'upload'>('meet');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    setProgress(null);
    onClose();
  };

  const sendBot = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await api<{ call?: { id: string } }>('/api/calls/calls', { method: 'POST', json: { meetingUrl: url.trim(), ...(title.trim() ? { title: title.trim() } : {}) } });
    setBusy(false);
    if (!res.ok || !res.data.call) return setError(err(res.data.error));
    setUrl('');
    setTitle('');
    onClose();
    router.push(`/app/calls/call/${res.data.call.id}`);
    router.refresh();
  };

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !file) return;
    setBusy(true);
    setError(null);
    const res = await api<{ call?: { id: string } }>('/api/calls/calls', {
      method: 'POST',
      json: { upload: { title: title.trim() || file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 200), mime: file.type || 'application/octet-stream', size: file.size } },
    });
    if (!res.ok || !res.data.call) {
      setBusy(false);
      return setError(err(res.data.error));
    }
    const id = res.data.call.id;
    try {
      await uploadRecording(id, file, (done, total) => setProgress(t('progress', { done, total })));
    } catch (x) {
      setBusy(false);
      setProgress(null);
      return setError(err(x instanceof Error ? x.message : 'generic'));
    }
    setBusy(false);
    setProgress(null);
    setFile(null);
    setTitle('');
    onClose();
    router.push(`/app/calls/call/${id}`);
    router.refresh();
  };

  return (
    <CallsDialog open={open} title={t('title')} onClose={close}>
      <div className="ui-tabs cl-dialog-tabs" role="tablist" aria-label={t('title')}>
        <button type="button" role="tab" className="ui-tab" aria-selected={tab === 'meet'} onClick={() => setTab('meet')} data-testid="calls-new-tab-meet">
          {t('meetTab')}
        </button>
        <button type="button" role="tab" className="ui-tab" aria-selected={tab === 'upload'} onClick={() => setTab('upload')} data-testid="calls-new-tab-upload">
          {t('uploadTab')}
        </button>
      </div>
      {tab === 'meet' ? (
        <form onSubmit={sendBot} className="ui-modal-body cl-form">
          {!botConfigured && <p className="cl-note">{t('botMissing')}</p>}
          <div className="ui-field">
            <label htmlFor="cl-meet-url">{t('meetLabel')}</label>
            <input
              id="cl-meet-url"
              className="input"
              type="url"
              inputMode="url"
              required
              autoFocus
              placeholder="https://meet.google.com/abc-defg-hij"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              data-testid="calls-meet-url"
            />
            <p className="ui-help">{t('meetHelp')}</p>
          </div>
          <div className="ui-field">
            <label htmlFor="cl-meet-title">{t('titleLabel')}</label>
            <input id="cl-meet-title" className="input" maxLength={200} placeholder={t('titlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()} data-testid="calls-send-bot">
              {busy ? t('sending') : t('send')}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={upload} className="ui-modal-body cl-form">
          <div className="ui-field">
            <label htmlFor="cl-upload-file">{t('uploadLabel')}</label>
            <input
              id="cl-upload-file"
              className="input"
              type="file"
              accept="audio/*,video/mp4,video/webm,video/quicktime"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="calls-upload-file"
            />
            <p className="ui-help">{t('uploadHelp')}</p>
          </div>
          <div className="ui-field">
            <label htmlFor="cl-upload-title">{t('titleLabel')}</label>
            <input id="cl-upload-title" className="input" maxLength={200} placeholder={t('titlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {progress && (
            <p className="ui-help" role="status">
              {progress}
            </p>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !file} data-testid="calls-upload">
              {busy ? t('uploading') : t('upload')}
            </button>
          </div>
        </form>
      )}
    </CallsDialog>
  );
}
