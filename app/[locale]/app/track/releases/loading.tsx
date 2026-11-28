import { getTranslations } from 'next-intl/server';

/** Mientras carga la lista de releases. */
export default async function Loading() {
  const t = await getTranslations('track.releases');
  return (
    <div className="app-page track-page ui-page track-releases-page" aria-busy="true">
      <p className="ui-help track-releases-loading" role="status">
        {t('loading')}
      </p>
    </div>
  );
}
