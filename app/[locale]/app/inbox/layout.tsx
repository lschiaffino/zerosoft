import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import InboxBranch from '@/components/inbox/InboxBranch';
import CalmFocus from '@/components/app/CalmFocus';
import { ChatStyleProvider } from '@/components/chat-style/ChatStyle';
import { getChatDisplay, getChatStyle } from '@/lib/chat-style';
import { realUserId, requireUser } from '@/lib/session';
import '@/styles/inbox.css';
// La cara de WhatsApp Web: la de Groups (fondos, burbujas, media, visor) y lo propio de Inbox encima.
import '@/styles/groups.css';
import '@/styles/groups-wa.css';
// HubSpot en la info del chat y el panel con todas las propiedades (el mismo de Lines).
import '@/styles/groups-hubspot.css';
import '@/styles/wa-newchat.css';
import '@/styles/inbox-wa.css';
import '@/styles/inbox-tools.css';
import '@/styles/chat-gestures.css';
import '@/styles/fleet.css';
import '@/styles/wa-touch.css';
import '@/styles/wa-mobile.css';
import '@/styles/wa-accent.css';

/** Inbox (personal): WhatsApp y Gmail de la persona. Las carpetas cuelgan del sidebar del shell. */
export default async function InboxLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const [chatStyle, chatDisplay] = await Promise.all([getChatStyle(realUserId(user)), getChatDisplay(realUserId(user))]);
  return (
    <ClientMessages locale={locale} namespaces={['inbox', 'inboxWa', 'groups.wa', 'groups.common', 'groups.media', 'groups.thread', 'groups.polls', 'groups.errors', 'fleet', 'groups.hubspot', 'groups.props', 'groups.time']}>
      <ChatStyleProvider initial={chatStyle} initialDisplay={chatDisplay}>
        {props.children}
        <InboxBranch />
        <CalmFocus />
      </ChatStyleProvider>
    </ClientMessages>
  );
}
