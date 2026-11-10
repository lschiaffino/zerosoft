'use client';

import { useTranslations } from 'next-intl';
import SharedWhenDialog from '@/components/ui/WhenDialog';

export type WhenKind = 'snooze' | 'followUp' | 'sendLater';

/**
 * Elegir cuándo en Inbox: posponer, recordar si no contesta o programar un
 * envío. El diálogo (presets con atajos del 1 al 6 y una fecha propia) es el
 * compartido de components/ui/WhenDialog; acá van los textos de Inbox.
 */
export default function WhenDialog({ kind, onPick, onClose }: { kind: WhenKind | null; onPick: (iso: string) => void; onClose: () => void }) {
  const t = useTranslations('inbox.when');
  return (
    <SharedWhenDialog
      open={!!kind}
      title={kind ? t(`title.${kind}`) : ''}
      help={kind === 'followUp' ? t('followUpHelp') : undefined}
      labels={{ preset: (p) => t(`preset.${p}`), custom: t('custom'), confirm: t('confirm'), cancel: t('cancel'), pastError: t('pastError') }}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
