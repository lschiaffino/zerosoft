'use client';

import { useTranslations } from 'next-intl';

/**
 * En lugar del campo de mensaje, en un grupo del que la cuenta (o la línea)
 * ya no es miembro, como WhatsApp: "No podés enviar mensajes a este grupo
 * porque ya no sos miembro". El chat sigue como historial de solo lectura.
 * Lo usan Lines (components/groups/ChatThread.tsx) e Inbox
 * (components/inbox/wa/WaConversation.tsx).
 */
export default function LeftGroupBar() {
  const t = useTranslations('groups.wa');
  return (
    <div className="wa-left-bar" role="status" data-testid="wa-left-bar">
      {t('leftGroupBar')}
    </div>
  );
}
