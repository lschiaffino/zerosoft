import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
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

  return (
    <div className="app-page">
      <div>
        <Link href="/app/crm/lists" className="back-link">
          {t('lists.back')}
        </Link>
      </div>

      <header className="detail-header">
        <div className="detail-title-row">
          <h1 className="detail-title">{list.name}</h1>
          <span className={`badge kind-${list.kind}`}>{t(`lists.${list.kind}`)}</span>
        </div>
        <div className="detail-meta">
          <span className="detail-meta-item muted">{t('lists.members', { count: memberCount })}</span>
          {list.kind === 'dynamic' && (
            <span className="detail-meta-item muted">{t('lists.dynamicNote')}</span>
          )}
        </div>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2 className="section-label">{t('lists.membersTitle')}</h2>
          <span className="panel-more">{memberCount}</span>
        </div>

        {list.kind === 'static' ? (
          <ListMembers listId={list.id} members={memberRows} />
        ) : memberRows.length === 0 ? (
          <p className="muted">{t('lists.emptyMembers')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table crm-table">
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
                    <td className="mono muted cell-date">{m.created}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
