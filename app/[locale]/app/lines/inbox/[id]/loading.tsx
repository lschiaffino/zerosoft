import { useTranslations } from 'next-intl';

/**
 * Cambio de chat: el chat anterior se desmonta en el momento (con su
 * composer), así nada de lo que se escriba o mande durante el cambio puede
 * terminar en el chat que se estaba dejando.
 */
export default function ChatLoading() {
  const t = useTranslations('groups');
  return (
    <section className="gr-thread gr-thread-loading" role="status" aria-label={t('common.loading')}>
      <div className="ui-loading-stack gr-thread-skeleton">
        <span className="ui-skeleton ui-skeleton-title" />
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="ui-skeleton ui-skeleton-row" />
        ))}
      </div>
    </section>
  );
}
