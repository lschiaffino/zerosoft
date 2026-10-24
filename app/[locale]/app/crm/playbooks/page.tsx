import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { listPlaybooks } from '@/lib/crm-playbooks';
import { formatDate } from '@/lib/utils';
import PlaybooksIndex from '@/components/crm/PlaybooksIndex';

export const dynamic = 'force-dynamic';

export default async function PlaybooksPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const rows = await listPlaybooks(user.id);
  return (
    <div className="app-page ui-page">
      <PlaybooksIndex
        title={t('playbooks.title')}
        canEdit={isWorkspaceAdmin(user)}
        rows={rows.map((p) => ({
          id: p.id,
          name: p.name,
          questions: p.questions.length,
          entities: p.entities.map((e) => t(`playbooks.entity.${e}`)).join(', '),
          uses: p.uses,
          updated: formatDate(p.updated_at, locale),
        }))}
      />
    </div>
  );
}
