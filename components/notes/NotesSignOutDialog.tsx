'use client';

import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

/**
 * Cerrar sesión con cambios de Notes sin subir (o sin red): al salir se borra
 * la copia del dispositivo, así que primero se avisa y se ofrece bajar el
 * texto de lo que falta subir.
 */
export default function NotesSignOutDialog({
  open,
  count,
  offline,
  text,
  onClose,
  onSignOut,
}: {
  open: boolean;
  count: number;
  offline: boolean;
  text: string;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const t = useTranslations('notes.signOut');
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'notes-pending.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <ConfirmDialog
      open={open}
      title={count ? t('title', { count }) : t('offlineTitle')}
      body={
        <>
          <p>{count ? t('body') : t('offlineBody')}</p>
          {count > 0 && offline && <p>{t('offlineNote')}</p>}
          {count > 0 && text && (
            <p>
              <button type="button" className="btn btn-sm" onClick={download}>
                {t('download')}
              </button>
            </p>
          )}
        </>
      }
      confirmLabel={t('confirm')}
      cancelLabel={t('cancel')}
      danger
      onConfirm={onSignOut}
      onCancel={onClose}
    />
  );
}
