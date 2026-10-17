import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

/** Sin conversación elegida: la columna central explica cómo moverse. En mobile se ve solo la lista. */
export default async function ChatInboxPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'chat' });

  return (
    <section className="chat-thread chat-thread-idle" aria-label={t('inbox.pickTitle')}>
      <div className="chat-idle">
        <h2 className="chat-idle-title">{t('inbox.pickTitle')}</h2>
        <dl className="chat-keys">
          <div>
            <dt>
              <kbd className="kbd">J</kbd> <kbd className="kbd">K</kbd>
            </dt>
            <dd>{t('inbox.keysNav')}</dd>
          </div>
          <div>
            <dt>
              <kbd className="kbd">/</kbd>
            </dt>
            <dd>{t('inbox.keysSearch')}</dd>
          </div>
          <div>
            <dt>
              <kbd className="kbd">Enter</kbd>
            </dt>
            <dd>{t('inbox.keysSend')}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
