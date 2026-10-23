import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { pickMessages, type MessageTree } from '@/lib/i18n-messages';
import MessagesScope from './MessagesScope';

/**
 * Manda al cliente solo los namespaces i18n que usan los componentes cliente
 * de esta parte del árbol. El layout raíz lo usa con `root` (crea el provider
 * con lo común) y cada layout de app suma lo suyo encima.
 *
 * tests/unit/i18n-client-namespaces.test.ts recorre las rutas y falla si un
 * componente cliente lee un namespace que su ruta no provee: al usar uno nuevo
 * en un componente, sumalo al `namespaces` del layout que corresponde.
 */
export default async function ClientMessages({
  locale,
  namespaces,
  root = false,
  children,
}: {
  locale: string;
  namespaces: string[];
  root?: boolean;
  children: ReactNode;
}) {
  const messages = pickMessages((await getMessages({ locale })) as MessageTree, namespaces);
  if (root) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    );
  }
  return <MessagesScope messages={messages}>{children}</MessagesScope>;
}
