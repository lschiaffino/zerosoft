import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listTrash, trashDaysLeft, TRASH_ENTITIES, TRASH_RETENTION_DAYS, type TrashEntity } from '@/lib/crm-trash';
import { formatDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import TrashTable, { type TrashTableRow } from '@/components/crm/TrashTable';

export const dynamic = 'force-dynamic';

interface TrashPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Papelera del CRM: lo borrado en los últimos 90 días, restaurable (lib/crm-trash.ts). */
export default async function CrmTrashPage(props: TrashPageProps) {
  const { locale } = await props.params;
  const searchParams = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const entityParam = typeof searchParams.entity === 'string' ? searchParams.entity : '';
  const entity = (TRASH_ENTITIES as readonly string[]).includes(entityParam) ? (entityParam as TrashEntity) : undefined;
  const q = typeof searchParams.q === 'string' ? searchParams.q.trim().slice(0, 200) : '';

  const entries = await listTrash(user.id, { entity, q: q || undefined, ownerScope: await sessionScope(user) });
  const rows: TrashTableRow[] = entries.map((e) => ({
    id: e.id,
    entity: e.entity,
    label: e.label,
    owner: e.owner_name ?? '',
    deletedBy: e.deleted_by,
    deletedAt: formatDate(e.deleted_at, locale),
    daysLeft: trashDaysLeft(e.deleted_at),
  }));

  const tabQuery = (value?: TrashEntity) => {
    const query: Record<string, string> = {};
    if (value) query.entity = value;
    if (q) query.q = q;
    return query;
  };

  return (
    <div className="ui-page crm-list-page">
      <PageHeader title={t('trash.title')} description={t('trash.description', { days: TRASH_RETENTION_DAYS })} />

      <div className="task-controls">
        <nav className="ui-tabs" aria-label={t('trash.title')}>
          <Link href={{ pathname: '/app/crm/trash', query: tabQuery() }} className="ui-tab" aria-current={!entity ? 'page' : undefined}>
            {t('trash.all')}
          </Link>
          {TRASH_ENTITIES.map((value) => (
            <Link
              key={value}
              href={{ pathname: '/app/crm/trash', query: tabQuery(value) }}
              className="ui-tab"
              aria-current={entity === value ? 'page' : undefined}
            >
              {t(`trash.entity.${value}`)}
            </Link>
          ))}
        </nav>
        <form className="task-filters" action="" method="get">
          {entity && <input type="hidden" name="entity" value={entity} />}
          <input
            className="input"
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t('trash.search')}
            aria-label={t('trash.search')}
          />
        </form>
      </div>

      {rows.length === 0 ? (
        q || entity ? (
          <EmptyState title={t('record.empty.noMatchTitle')} body={t('trash.noMatch')} action={{ label: t('common.clear'), href: '/app/crm/trash' }} />
        ) : (
          <EmptyState title={t('trash.empty')} body={t('trash.emptyBody')} />
        )
      ) : (
        <TrashTable rows={rows} canPurge={isWorkspaceAdmin(user)} />
      )}
    </div>
  );
}
