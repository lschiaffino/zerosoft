import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { workspaceTeamId } from '@/lib/workspace';
import { listMembers } from '@/lib/teams';
import { listSalesTeams } from '@/lib/crm-visibility';
import { listViews, sessionViewViewer } from '@/lib/crm-views';
import { VIEW_ENTITIES, isViewEntity } from '@/lib/crm-views-shared';
import { formatDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import AllViewsTable, { type AllViewsRow } from '@/components/crm/AllViewsTable';

export const dynamic = 'force-dynamic';

interface ViewsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * "Todas las vistas" de un objeto, como en HubSpot: las vistas guardadas que
 * la persona ve (las privadas de otras personas no existen para ella), con
 * búsqueda y filtros por quién la creó y con quién está compartida.
 */
export default async function CrmViewsPage(props: ViewsPageProps) {
  const { locale } = await props.params;
  const searchParams = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const entity = isViewEntity(searchParams.entity) ? searchParams.entity : 'contacts';

  const viewer = await sessionViewViewer(user);
  const teamId = workspaceTeamId(user);
  const [views, teams, members] = await Promise.all([
    listViews(viewer, { entity }),
    listSalesTeams(viewer.workspaceId),
    teamId ? listMembers(teamId) : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null }]),
  ]);
  const people = new Map(members.map((m) => [m.user_id, m.name ?? m.email]));
  const teamNames = new Map(teams.map((x) => [x.id, x.name]));

  const rows: AllViewsRow[] = views.map((v) => ({
    id: v.id,
    name: v.name,
    createdBy: v.createdBy,
    createdByLabel: v.mine ? t('views.all.you') : people.get(v.createdBy) ?? t('views.all.formerMember'),
    mine: v.mine,
    canEdit: v.canEdit,
    visibility: v.visibility,
    sharedLabel:
      v.visibility === 'team'
        ? t('views.all.sharedTeam', { team: (v.teamId && teamNames.get(v.teamId)) || t('views.visibility.team') })
        : t(`views.visibility.${v.visibility}`),
    updated: formatDate(v.updatedAt, locale),
    href: `/app/crm/${entity}?sv=${v.id}`,
  }));
  const creators = [...new Map(rows.map((r) => [r.createdBy, r.createdByLabel])).entries()].map(([value, label]) => ({ value, label }));

  return (
    <div className="ui-page crm-list-page">
      <PageHeader title={t('views.all.title')} description={t('views.all.description')} />
      <nav className="ui-tabs" aria-label={t('views.all.entity')}>
        {VIEW_ENTITIES.map((e) => (
          <Link
            key={e}
            href={{ pathname: '/app/crm/views', query: { entity: e } }}
            className="ui-tab"
            aria-current={e === entity ? 'page' : undefined}
            data-testid={`all-views-${e}`}
          >
            {t(`views.all.entities.${e}`)}
          </Link>
        ))}
      </nav>
      <AllViewsTable key={entity} rows={rows} creators={creators} backHref={`/app/crm/${entity}`} />
    </div>
  );
}
