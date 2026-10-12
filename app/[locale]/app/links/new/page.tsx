import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { shortDomain } from '@/lib/utils';
import NewLinkForm from '@/components/link/NewLinkForm';

export const dynamic = 'force-dynamic';

export default async function NewLinkPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });

  return (
    <div className="app-page narrow">
      <h1 className="app-title">{t('new.title')}</h1>
      <p className="app-sub muted">{t('new.sub')}</p>
      <NewLinkForm domain={shortDomain()} />
    </div>
  );
}
