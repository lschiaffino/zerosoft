'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';

/**
 * "Guardar como plantilla": copia la página (título, ícono y bloques tal
 * como están guardados) a las plantillas del workspace, que aparecen en el
 * inicio de Docs para todo el equipo. <dialog> nativo con showModal().
 */
export default function SaveTemplateDialog({
  pageId,
  defaultTitle,
  onClose,
}: {
  pageId: string;
  defaultTitle: string;
  onClose: () => void;
}) {
  const t = useTranslations('docs.templates');
  const uid = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'limit'>('idle');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const save = async () => {
    if (state === 'saving') return;
    setState('saving');
    try {
      const res = await fetch('/api/docs/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: pageId, title: title.trim(), description: description.trim() }),
      });
      if (res.status === 409) setState('limit');
      else setState(res.ok ? 'saved' : 'error');
    } catch {
      setState('error');
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="ui-modal docs-template-dialog"
      aria-labelledby={`${uid}-title`}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="ui-modal-head">
        <h2 className="ui-modal-title" id={`${uid}-title`}>
          {t('saveAs')}
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={() => dialogRef.current?.close()}
          aria-label={t('close')}
          title={t('close')}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="ui-modal-body">
          {state === 'saved' ? (
            <p className="docs-template-saved" role="status">
              {t('saved')}
            </p>
          ) : (
            <div className="ui-fields">
              <p className="docs-template-help">{t('saveHelp')}</p>
              <div className="ui-field">
                <label className="label" htmlFor={`${uid}-name`}>
                  {t('name')}
                </label>
                <input
                  id={`${uid}-name`}
                  className="input"
                  value={title}
                  maxLength={200}
                  autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={`${uid}-desc`}>
                  {t('description')}
                </label>
                <input
                  id={`${uid}-desc`}
                  className="input"
                  value={description}
                  maxLength={300}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              {(state === 'error' || state === 'limit') && (
                <p className="ui-error" role="alert">
                  {t(state === 'limit' ? 'limit' : 'error')}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="ui-modal-foot">
          {state === 'saved' ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => dialogRef.current?.close()}>
              {t('done')}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => dialogRef.current?.close()}>
                {t('cancel')}
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={state === 'saving'}
                aria-busy={state === 'saving' || undefined}
              >
                {t('save')}
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
