'use client';

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { api, pumpVersion, uploadFile, useErrorText, type UploadedVersion } from './ui';

const ACCEPT = '.pdf,.docx,.pptx,.mp4,.webm,.mov,.m4v,application/pdf,video/mp4,video/webm,video/quicktime';

/** Documento nuevo: subir un archivo o elegir una página de Docs. */
export default function NewDocument({ docsAvailable, maxDocMb, maxVideoMb }: { docsAvailable: boolean; maxDocMb: number; maxVideoMb: number }) {
  const t = useTranslations('send');
  const errorText = useErrorText();
  const router = useRouter();
  const [source, setSource] = useState<'upload' | 'docs'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [docsQ, setDocsQ] = useState('');
  const [docs, setDocs] = useState<Array<{ id: string; title: string }>>([]);
  const [docId, setDocId] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (source !== 'docs' || !docsAvailable) return;
    const h = window.setTimeout(async () => {
      const r = await api<{ pages: Array<{ id: string; title: string }> }>(`/api/send/docs?q=${encodeURIComponent(docsQ)}`);
      if (r.ok) setDocs(r.data.pages);
    }, 200);
    return () => window.clearTimeout(h);
  }, [docsQ, source, docsAvailable]);

  const onProgress = (p: { phase: 'upload' | 'process'; done: number; total: number }) => {
    setProgress(p.phase === 'upload' ? t('new.uploading', { pct: Math.round((p.done / p.total) * 100) }) : p.total ? t('new.rendering', { done: p.done, total: p.total }) : t('new.preparing'));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (source === 'upload' && !file) return setError(t('new.pickFile'));
    if (source === 'docs' && !docId) return setError(t('new.pickPage'));
    setBusy(true);
    setProgress(t('new.preparing'));
    try {
      const body = source === 'upload' ? { title: title.trim() || undefined, file: { name: file!.name, mime: file!.type, size: file!.size } } : { title: title.trim() || undefined, docsPageId: docId };
      const r = await api<{ document: { id: string }; version: UploadedVersion }>('/api/send/documents', { method: 'POST', json: body });
      if (!r.ok) return setError(errorText(r.data.error));
      const { document, version } = r.data;
      const done = source === 'upload' ? await uploadFile(version.id, file!, onProgress) : await pumpVersion(version.id, version, onProgress);
      // También con error: el detalle explica qué pasó y deja reemplazar el archivo.
      void done;
      router.push(`/app/send/documents/${document.id}`);
    } catch (err) {
      setError(errorText(err instanceof Error ? err.message : 'generic'));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  return (
    <div className="app-page ui-page sd-page sd-narrow">
      <PageHeader title={t('new.title')} description={t('new.desc')} />
      <form onSubmit={submit} className="sd-form">
        <div className="ui-tabs" role="tablist" aria-label={t('new.source')}>
          <button type="button" role="tab" className="ui-tab" aria-selected={source === 'upload'} onClick={() => setSource('upload')}>
            {t('new.upload')}
          </button>
          <button type="button" role="tab" className="ui-tab" aria-selected={source === 'docs'} onClick={() => setSource('docs')} data-testid="send-source-docs">
            {t('new.docs')}
          </button>
        </div>
        {source === 'upload' ? (
          <>
            <label
              className={`sd-drop${drag ? ' is-drag' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              <input ref={input} className="sr-only" type="file" accept={ACCEPT} data-testid="send-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <strong>{file ? file.name : t('new.dropTitle')}</strong>
              <span>{t('new.dropHint', { doc: maxDocMb, video: maxVideoMb / 1024 })}</span>
            </label>
            <p className="sd-help">{t('new.formats')}</p>
          </>
        ) : docsAvailable ? (
          <div className="sd-field">
            <label htmlFor="sd-docs-q">{t('new.docsSearch')}</label>
            <input id="sd-docs-q" className="input" value={docsQ} onChange={(e) => setDocsQ(e.target.value)} data-testid="send-docs-q" />
            <div className="sd-picklist" role="listbox" aria-label={t('new.docs')}>
              {docs.map((d) => (
                <button key={d.id} type="button" role="option" aria-selected={docId === d.id} className={docId === d.id ? 'is-on' : ''} onClick={() => setDocId(d.id)}>
                  {d.title || t('new.untitled')}
                </button>
              ))}
              {!docs.length && <p className="sd-help">{t('new.docsEmpty')}</p>}
            </div>
            <p className="sd-help">{t('new.docsNote')}</p>
          </div>
        ) : (
          <p className="sd-help">{t('new.docsUnavailable')}</p>
        )}
        <div className="sd-field">
          <label htmlFor="sd-title">{t('new.titleLabel')}</label>
          <input id="sd-title" className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t('new.titlePlaceholder')} data-testid="send-title" />
        </div>
        {error && (
          <p className="sd-error" role="alert">
            {error}
          </p>
        )}
        {busy && progress && (
          <p className="sd-progress" role="status" data-testid="send-progress">
            {progress}
          </p>
        )}
        <div className="sd-actions">
          <button className="btn btn-primary" type="submit" disabled={busy} data-testid="send-create">
            {busy ? t('new.working') : t('new.create')}
          </button>
          <Link className="btn btn-ghost" href="/app/send">
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </div>
  );
}
