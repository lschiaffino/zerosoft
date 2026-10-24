import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listLists } from '@/lib/crm';
import { sessionScope } from '@/lib/crm-visibility';
import { formatDate } from '@/lib/utils';
import ListsIndex, { type ListRow } from '@/components/crm/ListsIndex';
import { listFieldsFor } from '@/components/crm/listFieldsData';

export const dynamic = 'force-dynamic';

export default async function ListsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const scope = await sessionScope(user);
  const [lists, fields] = await Promise.all([listLists(user.id, scope), listFieldsFor(user, locale)]);

  const rows: ListRow[] = lists.map((l) => ({
    id: l.id,
    name: l.name,
    entity: l.entity,
    kind: l.kind,
    memberCount: l.memberCount,
    created: formatDate(l.created_at, locale),
  }));

  return (
    <div className="app-page">
      <ListsIndex title={t('lists.title')} rows={rows} fields={fields} />
    </div>
  );
}
