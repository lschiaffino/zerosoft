import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { requireUser } from '@/lib/session';
import { getList, LIFECYCLE_STAGES } from '@/lib/crm';
import { formatDate } from '@/lib/utils';
import ListMembers, { type MemberRow } from '@/components/crm/ListMembers';

export const dynamic = 'force-dynamic';

interface ListDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function ListDetailPage(props: ListDetailPageProps) {
  const params = await props.params;

  const {
    locale,
    id
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const detail = await getList(user.id, id);
  if (!detail) notFound();
  const { list, members, memberCount } = detail;

  const lifecycleLabel = (v: string): string =>
    (LIFECYCLE_STAGES as readonly string[]).includes(v) ? t(`enums.lifecycle.${v}`) : v;

  const memberRows: MemberRow[] = members.map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
    email: c.email,
    company: c.company_name ?? '',
    lifecycle: c.lifecycle_stage,
    lifecycleLabel: lifecycleLabel(c.lifecycle_stage),
    created: formatDate(c.created_at, locale),
  }));

  const head = (
    <thead>
      <tr>
        <th scope="col">{t('contacts.table.name')}</th>
        <th scope="col">{t('contacts.table.email')}</th>
        <th scope="col">{t('contacts.table.company')}</th>
        <th scope="col">{t('contacts.table.lifecycle')}</th>
        <th scope="col">{t('contacts.table.created')}</th>
      </tr>
    </thead>
  );

  return (
    <div className="ui-page crm-list-page">
      <PageHeader
        back={{ href: '/app/crm/lists', label: t('record.back.lists') }}
        title={list.name}
        description={
          <span className="record-meta">
            <span className={`badge kind-${list.kind}`}>{t(`lists.${list.kind}`)}</span>
            <span>{t('lists.members', { count: memberCount })}</span>
            {list.kind === 'dynamic' && <span>{t('lists.dynamicNote')}</span>}
          </span>
        }
      />

      {list.kind === 'static' ? (
        <ListMembers listId={list.id} members={memberRows} />
      ) : memberRows.length === 0 ? (
        <EmptyState title={t('record.empty.dynamicListTitle')} body={t('record.empty.dynamicListBody')} />
      ) : (
        <div className="table-wrap">
          <table className="table crm-table">
            <caption className="sr-only">{t('lists.membersTitle')}</caption>
            {head}
            <tbody>
              {memberRows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/app/crm/contacts/${m.id}`} className="cell-name">
                      {m.name}
                    </Link>
                  </td>
                  <td className="muted cell-email">{m.email || '—'}</td>
                  <td className="muted">{m.company || '—'}</td>
                  <td>
                    <span className={`badge stage-${m.lifecycle}`}>{m.lifecycleLabel}</span>
                  </td>
                  <td className="num muted cell-date">{m.created}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
