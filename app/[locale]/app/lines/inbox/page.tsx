import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

/** Sin chat elegido: cómo moverse con el teclado. En mobile se ve solo la lista. */
export default async function GroupsInboxPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'groups' });
  const keys: Array<[string[], string]> = [
    [['J', 'K'], t('inbox.keysNav')],
    [['/'], t('inbox.keysSearch')],
    [['R'], t('inbox.keysReply')],
    [['N'], t('inbox.keysNote')],
    [['E'], t('inbox.keysClose')],
    [['A'], t('inbox.keysAssign')],
    [['T'], t('inbox.keysTicket')],
    [['U'], t('inbox.keysUnread')],
    [['P'], t('inbox.keysPin')],
    [['L'], t('inbox.keysTranslate')],
    [['X'], t('inbox.keysSelect')],
    [['⌘', 'K'], t('inbox.keysSearchAll')],
  ];
  return (
    <section className="gr-thread gr-thread-idle" aria-label={t('inbox.pickTitle')}>
      <div className="gr-idle">
        <h2 className="gr-idle-title">{t('inbox.pickTitle')}</h2>
        <dl className="gr-keys">
          {keys.map(([k, label]) => (
            <div key={label}>
              <dt>
                {k.map((x) => (
                  <kbd key={x} className="kbd">
                    {x}
                  </kbd>
                ))}
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
