import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { bioEditorLinks, getBioSettings } from '@/lib/link-bio';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import BioEditor from '@/components/link/BioEditor';

export const dynamic = 'force-dynamic';

export default async function BioSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });
  const [settings, links] = await Promise.all([getBioSettings(user.id), bioEditorLinks(user.id)]);
  const handle = user.handle ?? '';

  return (
    <div className="ui-page ui-page-narrow link-bio">
      <PageHeader
        title={t('bio.title')}
        description={t('bio.sub', { handle })}
        actions={
          settings.published && handle ? (
            <a className="btn" href={`/@${handle}`} target="_blank" rel="noreferrer">
              {t('bio.view')}
            </a>
          ) : undefined
        }
      />
      {isWorkspaceAdmin(user) ? (
        <BioEditor initial={settings} handle={handle} links={links} />
      ) : (
        <EmptyState title={t('bio.title')} body={t('errors.forbidden')} product="link" />
      )}
    </div>
  );
}
