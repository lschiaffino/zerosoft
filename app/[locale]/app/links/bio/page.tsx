import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { bioEditorLinks, getBioSettings } from '@/lib/link-bio';
import BioEditor from '@/components/link/BioEditor';

export const dynamic = 'force-dynamic';

export default async function BioSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });
  const settings = await getBioSettings(user.id);
  const links = await bioEditorLinks(user.id);

  return (
    <div className="app-page narrow">
      <h1 className="app-title">{t('bio.title')}</h1>
      <p className="app-sub muted">{t('bio.sub', { handle: user.handle ?? '' })}</p>
      <BioEditor initial={settings} handle={user.handle ?? ''} links={links} />
    </div>
  );
}
