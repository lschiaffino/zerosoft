import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { canAccessWidget } from '@/lib/chat-access';
import { requireUser } from '@/lib/session';
import { getChatWidget } from '@/lib/chat-data';
import { inboundAddress, inboundFake } from '@/lib/chat-email';
import CopyField from '@/components/chat/CopyField';

export const dynamic = 'force-dynamic';

/**
 * Canal email del widget: la dirección a la que se reenvía el soporte@ del
 * sitio (cada email abre una conversación que se responde por email) y cómo
 * vuelven las respuestas de los emails que le mandamos al visitante.
 */
export default async function WidgetEmailPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const widget = await getChatWidget(id);
  if (!widget || !await canAccessWidget(widget, user)) notFound();
  const t = await getTranslations({ locale, namespace: 'chat' });
  const address = inboundAddress('inbox', widget.id);
  const signed = !!process.env.RESEND_WEBHOOK_SECRET?.trim() || inboundFake();

  return (
    <section className="chat-pane" aria-labelledby="chat-email-title">
      <div className="chat-pane-head">
        <div>
          <h2 id="chat-email-title" className="ui-section-title">
            {t('emailChannel.title')}
          </h2>
          <p className="ui-section-desc">{t('emailChannel.sub')}</p>
        </div>
      </div>
      {address && signed ? (
        <div className="ui-fields">
          <div className="ui-field">
            <p className="label">{t('emailChannel.address')}</p>
            <CopyField value={address} label={t('emailChannel.address')} />
            <p className="ui-help">{t('emailChannel.forward')}</p>
          </div>
          <ul className="chat-email-points">
            <li>{t('emailChannel.pointNew')}</li>
            <li>{t('emailChannel.pointReply')}</li>
            <li>{t('emailChannel.pointOffline')}</li>
          </ul>
        </div>
      ) : (
        <div className="chat-email-off" role="status">
          <p>{t('emailChannel.off')}</p>
          <p className="ui-help">{t('emailChannel.offHint')}</p>
        </div>
      )}
    </section>
  );
}
