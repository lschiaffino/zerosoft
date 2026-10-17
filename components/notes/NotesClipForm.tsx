'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
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

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (state === 'saving') return;
    setState('saving');
    const res = await fetch('/api/notes/clip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, title: name, selection: text }),
    }).catch(() => null);
    if (!res?.ok) {
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
        <div className="ui-field">
          <label className="label" htmlFor="clip-text">
            {t('selection')}
          </label>
          <textarea id="clip-text" className="textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} maxLength={8000} />
        </div>
      </div>
      {state === 'error' && (
        <p className="ui-error" role="alert">
          {t('error')}
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
