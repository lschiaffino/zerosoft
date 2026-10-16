'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { clipBookmarklet } from '@/lib/notes-types';

export default function NotesClipForm({ url, title, selection }: { url: string; title: string; selection: string }) {
  const t = useTranslations('notes.clip');
  const [name, setName] = useState(title);
  const [text, setText] = useState(selection);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [noteId, setNoteId] = useState<string | null>(null);
  const locale = useLocale();
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);

  // Sin URL (entrada desde el sidebar): se ofrece instalar el bookmarklet.
  // React no deja renderizar href="javascript:…", así que se setea por DOM.
  useEffect(() => {
    if (!url && bookmarkletRef.current) {
      bookmarkletRef.current.setAttribute('href', clipBookmarklet(window.location.origin, locale));
    }
  }, [url, locale]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
      <div className="notes-clip-page">
        <h1>{t('title')}</h1>
        <p className="dim">{t('hint')}</p>
        <a ref={bookmarkletRef} className="notes-bookmarklet" onClick={(e) => e.preventDefault()} draggable>
          {t('bookmarkletName')}
        </a>
        <p className="dim">{t('missingUrl')}</p>
        <Link href="/app/notes" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
          {t('openNotes')}
        </Link>
      </div>
    );
  }

  if (state === 'saved' && noteId) {
    return (
      <div className="notes-clip-page">
        <h1>{t('saved')}</h1>
        <p className="dim">{name || url}</p>
        <div className="notes-clip-actions">
          <Link href={`/app/notes?note=${noteId}`} className="btn btn-solid">
            {t('openNote')}
          </Link>
          <button type="button" className="btn" onClick={() => window.close()}>
            {t('close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="notes-clip-page" onSubmit={save}>
      <h1>{t('title')}</h1>
      <p className="notes-clip-url mono">{url}</p>
      <label className="notes-clip-field">
        <span>{t('noteTitle')}</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={300} autoFocus />
      </label>
      <label className="notes-clip-field">
        <span>{t('selection')}</span>
        <textarea className="textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} maxLength={8000} />
      </label>
      {state === 'error' && <p className="notes-error">{t('error')}</p>}
      <div className="notes-clip-actions">
        <button type="submit" className="btn btn-solid" disabled={state === 'saving'}>
          {state === 'saving' ? t('saving') : t('save')}
        </button>
      </div>
    </form>
  );
}
