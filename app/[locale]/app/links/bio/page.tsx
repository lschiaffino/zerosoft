import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getBioSettings } from '@/lib/link-bio';
import { linkShortUrl, listLinks } from '@/lib/links';
import BioEditor from '@/components/link/BioEditor';

export const dynamic = 'force-dynamic';

export default async function BioSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });
  const settings = await getBioSettings(user.id);
  const { links } = await listLinks(user.id, { archived: '0', pageSize: 50 });

  return (
    <div className="app-page narrow">
      <h1 className="app-title">{t('bio.title')}</h1>
      <p className="app-sub muted">{t('bio.sub', { handle: user.handle ?? '' })}</p>
      <BioEditor
        initial={settings}
        handle={user.handle ?? ''}
        links={links.map((l) => ({ id: l.id, label: l.title || l.url, short: linkShortUrl(l) }))}
      />
    </div>
  );
}
