import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { shortDomain } from '@/lib/utils';
import NewLinkForm from '@/components/link/NewLinkForm';
import { listDomains } from '@/lib/link-domains';

export const dynamic = 'force-dynamic';

export default async function NewLinkPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const customDomains = (await listDomains(user.id))
    .filter((d) => d.verified === 1)
    .map((d) => ({ id: d.id, hostname: d.hostname }));
  const t = await getTranslations({ locale, namespace: 'link' });
  const initialUrl = typeof searchParams.url === 'string' ? searchParams.url.slice(0, 2000) : '';

  return (
    <div className="app-page narrow">
      <h1 className="app-title">{t('new.title')}</h1>
      <p className="app-sub muted">{t('new.sub')}</p>
      <NewLinkForm domain={shortDomain()} customDomains={customDomains} initialUrl={initialUrl} />
    </div>
  );
}
