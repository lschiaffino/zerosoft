import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import ChatInboxBranch from '@/components/chat/ChatInboxBranch';
import '@/styles/chat.css';

/** Chat: su hoja de estilos, los textos de sus componentes cliente y las bandejas y vistas del sidebar. */
export default async function ChatLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['chat']}>
      <Suspense fallback={null}>
        <ChatInboxBranch />
      </Suspense>
      {props.children}
    </ClientMessages>
  );
}
