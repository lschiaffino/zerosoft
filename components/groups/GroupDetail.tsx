'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ThreadProps } from './ChatThread';
import ChatDetails from './ChatDetails';

/** Página del grupo: los detalles a lo ancho y los últimos mensajes. */
export default function GroupDetail({ data }: { data: ThreadProps }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const [chat, setChat] = useState(data.chat);
  const recent = data.messages.filter((m) => m.direction === 'in' || m.direction === 'out').slice(-10);
  return (
    <div className="gr-group-page">
      <ChatDetails
        chat={chat}
        onChange={setChat}
        members={data.members}
        people={data.people}
        labels={data.labels}
        properties={data.properties}
        agents={data.agents}
        crm={data.crm}
        caps={data.caps}
      />
      <section className="gr-detail-section gr-recent">
        <h3 className="gr-detail-title">{t('detail.recent')}</h3>
        {recent.length === 0 ? (
          <p className="ui-help">{t('thread.noMessages')}</p>
        ) : (
          <ul className="gr-mini-list">
            {recent.map((m) => (
              <li key={m.id}>
                <span>
                  <strong>{m.direction === 'in' ? m.senderName || (m.senderPhone ? `+${m.senderPhone}` : '') : t('detail.team')}</strong>{' '}
                  {m.body.slice(0, 160) || (m.media ? `[${m.media.type.split('/')[0]}]` : '')}
                </span>
                <time className="ui-help" dateTime={m.createdAt}>
                  {new Date(m.createdAt).toLocaleString(locale)}
                </time>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/app/groups/inbox/${chat.id}`}>{t('detail.openInbox')}</Link>
      </section>
    </div>
  );
}
