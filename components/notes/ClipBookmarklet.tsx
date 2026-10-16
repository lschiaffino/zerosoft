'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { clipBookmarklet } from '@/lib/notes-types';
import NotesIcon from './NotesIcon';

/**
 * El botón "Guardar en Notas" para arrastrar a la barra de favoritos, con la
 * alternativa de copiar el código para crear el favorito a mano.
 * React no deja renderizar href="javascript:…", así que se setea por DOM.
 */
export default function ClipBookmarklet({ locale }: { locale: string }) {
  const t = useTranslations('notes.clip');
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [code, setCode] = useState('');
  const [nudge, setNudge] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const js = clipBookmarklet(window.location.origin, locale);
    setCode(js);
    linkRef.current?.setAttribute('href', js);
  }, [locale]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin permiso de portapapeles: el código queda visible para copiarlo a mano.
    }
  }

  return (
    <div className="notes-bookmarklet-wrap">
      <div className="notes-bookmarklet-row">
        <a
          ref={linkRef}
          className="notes-bookmarklet"
          draggable
          onClick={(e) => {
            // En esta página no hay nada que recortar: el clic explica qué hacer.
            e.preventDefault();
            setNudge(true);
          }}
          onDragStart={() => setNudge(false)}
        >
          <NotesIcon name="grip" size={14} />
          {t('bookmarkletName')}
        </a>
        <p className="notes-bookmarklet-nudge" role="status" aria-live="polite">
          {nudge ? t('dragOnly') : ''}
        </p>
      </div>
      <div className="ui-field notes-bookmarklet-manual">
        <p className="ui-help" id="clip-manual-help">
          {t('manual')}
        </p>
        <div className="notes-pop-row">
          <input className="input data" readOnly value={code} aria-describedby="clip-manual-help" aria-label={t('copyCode')} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-sm" onClick={() => void copy()} disabled={!code}>
            {copied ? t('copied') : t('copyCode')}
          </button>
        </div>
      </div>
    </div>
  );
}
