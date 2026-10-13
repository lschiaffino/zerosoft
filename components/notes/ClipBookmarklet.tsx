'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { clipBookmarklet } from '@/lib/notes-types';

/**
 * "Clip page": bookmarklet para arrastrar a la barra de favoritos. React no
 * deja renderizar href="javascript:…", así que se setea por DOM.
 */
export default function ClipBookmarklet({ locale }: { locale: string }) {
  const t = useTranslations('notes.clip');
  const [open, setOpen] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && linkRef.current) {
      linkRef.current.setAttribute('href', clipBookmarklet(window.location.origin, locale));
    }
  }, [open, locale]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="notes-clip" ref={wrapRef}>
      <button type="button" className="notes-nav-item" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {t('button')}
      </button>
      {open && (
        <div className="note-pop notes-clip-pop" role="dialog" aria-label={t('title')}>
          <p className="note-pop-title">{t('title')}</p>
          <p className="note-pop-hint">{t('hint')}</p>
          <a
            ref={linkRef}
            className="notes-bookmarklet"
            onClick={(e) => e.preventDefault()}
            draggable
          >
            {t('bookmarkletName')}
          </a>
        </div>
      )}
    </div>
  );
}
