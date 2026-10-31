'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { uploadDocsFile } from '@/lib/docs-upload-client';
import PageHeader from '@/components/ui/PageHeader';
import ClipBookmarklet from './ClipBookmarklet';

/**
 * /app/notes/clip. Sin URL (entrada desde el sidebar) explica e instala el
 * bookmarklet; con URL (abierta por el bookmarklet) muestra lo recortado y lo
 * guarda al confirmar.
 */
export default function NotesClipForm({ url, title, selection }: { url: string; title: string; selection: string }) {
  const t = useTranslations('notes.clip');
  const locale = useLocale();
  const [name, setName] = useState(title);
  const [text, setText] = useState(selection);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [noteId, setNoteId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<'article' | 'page' | 'selection' | 'bookmark' | 'screenshot'>(selection ? 'selection' : 'article');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const html = useRef<string | undefined>(undefined);
  const [canCapture, setCanCapture] = useState(false);

  useEffect(() => {
    setCanCapture(typeof navigator.mediaDevices?.getDisplayMedia === 'function');
  }, []);

  // El bookmarklet manda la página como la ve la persona (también con sesión).
  useEffect(() => {
    if (!url || !window.opener) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.opener) return;
      const value = (e.data as { zsClipHtml?: unknown } | null)?.zsClipHtml;
      if (typeof value === 'string') html.current = value;
    };
    window.addEventListener('message', onMessage);
    try {
      (window.opener as Window).postMessage('zs-clip-ready', '*');
    } catch {
      // La página no deja hablar con la ventana: el servidor baja la página.
    }
    return () => window.removeEventListener('message', onMessage);
  }, [url]);

  /** Pantalla compartida → imagen en una nota nueva. */
  async function screenshot(): Promise<string | null> {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) return null;
      const res = await fetch('/api/notes/clip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, title: name, mode: 'bookmark' }),
      });
      if (!res.ok) return null;
      const note = (await res.json()) as { id: string; content: unknown[]; updated_at: string };
      const file = await uploadDocsFile(new File([blob], 'screenshot.png', { type: 'image/png' }), { uploadUrl: `/api/notes/${note.id}/files` });
      const patch = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: [...note.content, { id: crypto.randomUUID(), type: 'image', content: '', ...file }] }),
      });
      return patch.ok ? note.id : null;
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (state === 'saving') return;
    setState('saving');
    setErrorCode(null);
    if (mode === 'screenshot') {
      const id = await screenshot().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') setErrorCode('screenshot_cancelled');
        return null;
      });
      if (!id) {
        setState('error');
        return;
      }
      setNoteId(id);
      setState('saved');
      return;
    }
    const res = await fetch('/api/notes/clip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, title: name, selection: text, mode, ...(mode === 'article' || mode === 'page' ? { html: html.current } : {}) }),
    }).catch(() => null);
    if (!res?.ok) {
      setErrorCode(res ? (((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? null) : null);
      setState('error');
      return;
    }
    const note = (await res.json()) as { id: string };
    setNoteId(note.id);
    setState('saved');
  }

  if (!url) {
    return (
      <div className="ui-page ui-page-narrow notes-clip-page">
        <PageHeader title={t('button')} description={t('lead')} />
        <ol className="notes-clip-steps">
          <li>
            <p className="notes-clip-step-title notes-clip-desk">{t('step1')}</p>
            <p className="ui-help notes-clip-desk">{t('step1Hint')}</p>
            <p className="notes-clip-step-title notes-clip-touch">{t('touchInstall')}</p>
            <ClipBookmarklet locale={locale} />
          </li>
          <li>
            <p className="notes-clip-step-title">{t('step2')}</p>
            <p className="ui-help">{t('step2Hint')}</p>
          </li>
          <li>
            <p className="notes-clip-step-title">{t('step3')}</p>
          </li>
        </ol>
      </div>
    );
  }

  if (state === 'saved' && noteId) {
    return (
      <div className="ui-page ui-page-narrow notes-clip-page">
        <PageHeader
          title={t('saved')}
          description={name || url}
          actions={
            <>
              <button type="button" className="btn" onClick={() => window.close()}>
                {t('close')}
              </button>
              <Link href={`/app/notes?note=${noteId}`} className="btn btn-primary">
                {t('openNote')}
              </Link>
            </>
          }
        />
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      className="ui-page ui-page-narrow notes-clip-page"
      onSubmit={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <PageHeader title={t('bookmarkletName')} />
      <div className="ui-fields">
        <div className="ui-field">
          <span className="label">{t('source')}</span>
          <p className="notes-clip-url data">{url}</p>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="clip-title">
            {t('noteTitle')}
          </label>
          <input id="clip-title" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={300} autoFocus />
        </div>
        <fieldset className="ui-field notes-clip-modes">
          <legend className="label">{t('modeLabel')}</legend>
          {(['article', 'page', 'selection', 'bookmark', ...(canCapture ? (['screenshot'] as const) : [])] as const).map((m) => (
            <label key={m} className="notes-clip-mode">
              <input type="radio" name="clip-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
              <span>
                <strong>{t(`modes.${m}`)}</strong>
                <span className="ui-help">{t(`modeHints.${m}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {mode === 'selection' && (
          <div className="ui-field">
            <label className="label" htmlFor="clip-text">
              {t('selection')}
            </label>
            <textarea id="clip-text" className="textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} maxLength={8000} />
          </div>
        )}
      </div>
      {state === 'error' && (
        <p className="ui-error" role="alert">
          {errorCode === 'fetch_failed' ? t('fetchError') : errorCode === 'empty_page' ? t('emptyPage') : errorCode === 'screenshot_cancelled' ? t('screenshotCancelled') : t('error')}
        </p>
      )}
      <div className="notes-clip-actions">
        <button type="submit" className="btn btn-primary" aria-busy={state === 'saving'}>
          {state === 'saving' ? t('saving') : t('save')}
        </button>
        <span className="ui-help notes-clip-shortcut">{t('saveHint')}</span>
      </div>
    </form>
  );
}
