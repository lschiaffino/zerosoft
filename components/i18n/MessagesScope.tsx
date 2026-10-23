'use client';

import { useMemo, type ReactNode } from 'react';
import { NextIntlClientProvider, useLocale, useMessages } from 'next-intl';
import { mergeMessages, type MessageTree } from '@/lib/i18n-messages';

/**
 * Suma los mensajes de una ruta (los namespaces de su app) a los que ya trae
 * el provider de arriba. Zona horaria, formatos y `now` se heredan del padre.
 */
export default function MessagesScope({ messages, children }: { messages: MessageTree; children: ReactNode }) {
  const parent = useMessages() as MessageTree;
  const locale = useLocale();
  const merged = useMemo(() => mergeMessages(parent, messages), [parent, messages]);
  return (
    <NextIntlClientProvider locale={locale} messages={merged}>
      {children}
    </NextIntlClientProvider>
  );
}
