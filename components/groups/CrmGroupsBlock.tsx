import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { chatsForCrmRecord, mediaKind } from '@/lib/groups';

/**
 * Bloque de Groups en la ficha de un contacto o empresa del CRM: los chats y
 * grupos de WhatsApp vinculados, con sus últimos mensajes, lo que espera
 * respuesta y los tickets abiertos. Se vincula desde el panel de detalles
 * del chat en Groups.
 */
export default async function CrmGroupsBlock({ ws, kind, recordId, locale }: { ws: string; kind: 'contact' | 'company'; recordId: string; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'groups' });
  const chats = await chatsForCrmRecord(ws, kind, recordId).catch(() => []);
  return (
    <div className="record-summary-block gr-crm-block" data-testid="crm-groups">
      <h2 className="record-summary-title">
        {t('crmBlock.title')} <span className="num">{chats.length}</span>
      </h2>
      {chats.length === 0 ? (
        <p className="muted">{t('crmBlock.empty')}</p>
      ) : (
        <ul className="gr-crm-chats">
          {chats.map(({ chat, messages, openTickets }) => (
            <li key={chat.id}>
              <div className="gr-crm-chat-head">
                <Link href={`/app/groups/inbox/${chat.id}`}>{chat.name}</Link>
                <span className="muted">
                  {chat.kind === 'group' ? t('thread.groupMeta', { n: chat.memberCount }) : `+${chat.phone}`}
                  {openTickets > 0 ? ` · ${t('crmBlock.tickets', { n: openTickets })}` : ''}
                </span>
                {chat.awaitingSince && <span className={`badge ${chat.flagged ? 'badge-bad' : 'badge-warn'}`}>{t('crmBlock.waiting')}</span>}
              </div>
              {messages.length > 0 && (
                <ol className="gr-crm-timeline">
                  {messages.map((m) => (
                    <li key={m.id}>
                      <time className="muted" dateTime={m.createdAt}>
                        {new Date(m.createdAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
                      </time>{' '}
                      <strong>{m.direction === 'out' ? t('detail.team') : m.senderName || (m.senderPhone ? `+${m.senderPhone}` : '')}</strong>{' '}
                      <span>{m.body.slice(0, 140) || (m.media ? m.media.name || t(`media.${mediaKind(m.media.type)}`) : '')}</span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
