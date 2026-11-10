import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import ClientMessages from '@/components/i18n/ClientMessages';
import GroupsListsBranch from '@/components/groups/GroupsListsBranch';
import GroupsFoldersBranch from '@/components/groups/GroupsFoldersBranch';
import GroupsPwa from '@/components/groups/GroupsPwa';
import { ChatStyleProvider } from '@/components/chat-style/ChatStyle';
import { getChatStyle, type ChatStyle } from '@/lib/chat-style';
import { getCurrentUser, realUserId } from '@/lib/session';
import '@/styles/groups.css';
import '@/styles/groups-wa.css';
import '@/styles/lines-folders.css';
import '@/styles/groups-later.css';

/** Instalable en iOS desde "Agregar a inicio" (el manifest de la suite sale de app/manifest.ts). */
export const metadata: Metadata = {
  appleWebApp: { capable: true, title: 'zerosoft', statusBarStyle: 'default' },
};

/**
 * Lines: su hoja de estilos, los textos de sus componentes cliente, las
 * listas guardadas en el sidebar, el registro del service worker de la suite
 * (push y app instalable) y el estilo de chats de la persona (WhatsApp o
 * zerosoft, el mismo ajuste que Inbox).
 */
export default async function GroupsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await getCurrentUser();
  const chatStyle: ChatStyle = user ? await getChatStyle(realUserId(user)) : 'whatsapp';
  return (
    <ClientMessages locale={locale} namespaces={['groups', 'inboxWa']}>
      <ChatStyleProvider initial={chatStyle}>
        <Suspense fallback={null}>
          <GroupsListsBranch />
          <GroupsFoldersBranch />
        </Suspense>
        <GroupsPwa />
        {props.children}
      </ChatStyleProvider>
    </ClientMessages>
  );
}
