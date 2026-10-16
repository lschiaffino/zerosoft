import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listSequences } from '@/lib/crm-sequences';
import { formatDate } from '@/lib/utils';
import SequencesIndex from '@/components/crm/SequencesIndex';

export const dynamic = 'force-dynamic';

export default async function SequencesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const sequences = await listSequences(user.id);
  return (
    <div className="app-page ui-page">
      <SequencesIndex
        title={t('sequences.title')}
        rows={sequences.map((s) => ({
          id: s.id,
          name: s.name,
          steps: s.step_count,
          active: s.active_count,
          total: s.total_count,
          updated: formatDate(s.updated_at, locale),
        }))}
      />
    </div>
  );
}
