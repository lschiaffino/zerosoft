import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import ClientMessages from '@/components/i18n/ClientMessages';
import GroupsListsBranch from '@/components/groups/GroupsListsBranch';
import GroupsFoldersBranch from '@/components/groups/GroupsFoldersBranch';
import GroupsPwa from '@/components/groups/GroupsPwa';
import { ChatStyleProvider } from '@/components/chat-style/ChatStyle';
import { getChatDisplay, getChatStyle, type ChatStyle } from '@/lib/chat-style';
import { DEFAULT_DISPLAY } from '@/lib/chat-display';
import { getCurrentUser, realUserId } from '@/lib/session';
import '@/styles/groups.css';
import '@/styles/groups-wa.css';
import '@/styles/wa-newchat.css';
import '@/styles/lines-folders.css';
import '@/styles/chat-gestures.css';
import '@/styles/groups-later.css';
import '@/styles/groups-hubspot.css';

/** Instalable en iOS desde "Agregar a inicio" (el manifest de la suite sale de app/manifest.ts). */
export const metadata: Metadata = {
  appleWebApp: { capable: true, title: 'zerosoft', statusBarStyle: 'default' },
};

/**
 * Lines: su hoja de estilos, los textos de sus componentes cliente, las
 * listas guardadas en el sidebar, el registro del service worker de la suite
 * (push y app instalable) y el estilo y la visualización de los chats de la
 * persona (los mismos ajustes que Inbox).
 */
export default async function GroupsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await getCurrentUser();
  const chatStyle: ChatStyle = user ? await getChatStyle(realUserId(user)) : 'whatsapp';
  const chatDisplay = user ? await getChatDisplay(realUserId(user)) : DEFAULT_DISPLAY;
  return (
    <ClientMessages locale={locale} namespaces={['groups', 'inboxWa']}>
      <ChatStyleProvider initial={chatStyle} initialDisplay={chatDisplay}>
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
