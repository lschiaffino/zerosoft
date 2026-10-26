'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { localRecording, pendingFor, saveFile } from './recStore';

/**
 * Al cerrar sesión con grabaciones de Rec sin subir en este navegador:
 * subirlas (lleva a Rec), descargarlas o descartarlas. Después de descargar o
 * descartar se cierra la sesión y se borran del navegador.
 */
export default function RecSignOutDialog({
  open,
  count,
  owner,
  onClose,
  onSignOut,
}: {
  open: boolean;
  count: number;
  owner: { userId: string; ws: string } | null;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const t = useTranslations('rec.signout');
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function downloadAll() {
    if (!owner) return;
    setBusy(true);
    for (const m of await pendingFor(owner.userId, owner.ws)) saveFile(await localRecording(m), `${m.title.replace(/[\\/:*?"<>|]+/g, ' ')}.webm`);
    setBusy(false);
    onSignOut();
  }

  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-labelledby="rec-signout-t"
      data-testid="rec-signout"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id="rec-signout-t">
              {t('title', { n: count })}
            </h2>
          </div>
          <div className="ui-modal-body">
            <p>{t('body')}</p>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost btn-danger btn-sm" disabled={busy} onClick={onSignOut} data-testid="rec-signout-discard">
              {t('discard')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void downloadAll()}>
              {t('download')}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              autoFocus
              onClick={() => {
                onClose();
                router.push('/app/rec');
              }}
            >
              {t('upload')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
