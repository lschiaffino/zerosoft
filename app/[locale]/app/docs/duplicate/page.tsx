import { getTranslations, setRequestLocale } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import DocsDuplicatePublic from '@/components/docs/DocsDuplicatePublic';
import { getHelpWorkspace } from '@/lib/docs-help';
import { duplicableSource } from '@/lib/docs-public-duplicate';
import { listTeamspaces } from '@/lib/docs-access';
import { canCreateDocPage } from '@/lib/docs-guard';

export const dynamic = 'force-dynamic';

/** Docs › Duplicar una página publicada (plantilla pública) a tu workspace. */
export default async function DocsDuplicatePage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ handle?: string; slug?: string }>;
}) {
  const { locale } = await props.params;
  const { handle = '', slug = '' } = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'docs.duplicatePublic' });
  const ws = handle ? await getHelpWorkspace(handle.slice(0, 64)) : null;
  const source = ws && slug ? await duplicableSource(ws.id, slug.slice(0, 200)) : null;
  const teamspaces: Array<{ id: string; name: string }> = [];
  for (const ts of await listTeamspaces(user.id, realUserId(user))) {
    if (!ts.deleted_at && (await canCreateDocPage(user, { teamspace_id: ts.id }))) teamspaces.push({ id: ts.id, name: ts.name });
  }
  const canWorkspace = await canCreateDocPage(user, {});
  return (
    <div className="ui-page ui-page-narrow">
      <p>
        <Link href="/app/docs" className="docs-inline-link">
          {t('back')}
        </Link>
      </p>
      <PageHeader title={t('title')} description={ws ? t('from', { name: ws.name }) : undefined} />
      {!source || !ws ? (
        <EmptyState title={t('notFound')} body={t('notFoundBody')} />
      ) : !canWorkspace && teamspaces.length === 0 ? (
        <EmptyState title={t('forbidden')} body={t('forbiddenBody')} />
      ) : (
        <DocsDuplicatePublic handle={ws.handle} slug={source.row.slug ?? slug} title={source.row.title} teamspaces={teamspaces} canWorkspace={canWorkspace} />
      )}
    </div>
  );
}
