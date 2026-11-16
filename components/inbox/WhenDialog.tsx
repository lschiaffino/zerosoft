'use client';

import { useTranslations } from 'next-intl';
import SharedWhenDialog from '@/components/ui/WhenDialog';

export type WhenKind = 'snooze' | 'followUp' | 'sendLater';

/**
 * Elegir cuándo en Inbox: posponer, recordar si no contesta o programar un
 * envío. El diálogo (opciones del momento con atajos 1, 2, 3… y día y hora a mano) es el
 * compartido de components/ui/WhenDialog; acá van los textos de Inbox.
 */
export default function WhenDialog({ kind, onPick, onClose }: { kind: WhenKind | null; onPick: (iso: string) => void; onClose: () => void }) {
  const t = useTranslations('inbox.when');
  return (
    <SharedWhenDialog
      open={!!kind}
      title={kind ? t(`title.${kind}`) : ''}
      help={kind === 'followUp' ? t('followUpHelp') : undefined}
      mode={kind === 'sendLater' ? 'send' : 'snooze'}
      labels={{ confirm: kind === 'sendLater' ? t('confirmSend') : t('confirm'), cancel: t('cancel') }}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
