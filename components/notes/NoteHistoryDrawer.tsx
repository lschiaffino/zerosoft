'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import VersionsPanel from '@/components/docs/VersionsPanel';
import { noteFileHref } from '@/lib/notes-types';
import NotesIcon from './NotesIcon';

/**
 * Historial de la nota: drawer nativo (como "Preguntale a tus notas") con el
 * panel de versiones de Docs apuntado a las rutas de Notes. Restaurar guarda
 * antes el estado actual, así que siempre se puede volver.
 */
export default function NoteHistoryDrawer({
  noteId,
  onClose,
  onRestored,
}: {
  noteId: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const t = useTranslations('notes.history');
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="ui-drawer notes-history"
      aria-labelledby="notes-history-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-drawer-head">
        <h2 id="notes-history-title" className="ui-drawer-title">
          {t('title')}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label={t('close')}>
          <NotesIcon name="close" size={16} />
        </button>
      </div>
      <div className="ui-drawer-body">
        <VersionsPanel
          pageId={noteId}
          canEdit
          showTitle={false}
          apiBase={`/api/notes/${encodeURIComponent(noteId)}`}
          fileHref={(blockId, opts) => noteFileHref(noteId, blockId, opts)}
          onRestored={() => {
            onRestored();
            onClose();
          }}
        />
      </div>
    </dialog>
  );
}
