import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { LEAD_STATUSES, LIFECYCLE_STAGES, listLists, SOURCES } from '@/lib/crm';
import { formatDate } from '@/lib/utils';
import ListsIndex, { type ListRow } from '@/components/crm/ListsIndex';

export const dynamic = 'force-dynamic';

export default async function ListsPage({ params: { locale } }: { params: { locale: string } }) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const lists = listLists(user.id);

  const rows: ListRow[] = lists.map((l) => ({
    id: l.id,
    name: l.name,
    entity: l.entity,
    kind: l.kind,
    memberCount: l.memberCount,
    created: formatDate(l.created_at, locale),
  }));

  const lifecycles = LIFECYCLE_STAGES.map((value) => ({ value, label: t(`enums.lifecycle.${value}`) }));
  const leadStatuses = LEAD_STATUSES.map((value) => ({ value, label: t(`enums.leadStatus.${value}`) }));
  const sources = SOURCES.map((value) => ({ value, label: t(`enums.source.${value}`) }));

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('lists.title')}</h1>
      </div>
      <ListsIndex rows={rows} lifecycles={lifecycles} leadStatuses={leadStatuses} sources={sources} />
    </div>
  );
}
