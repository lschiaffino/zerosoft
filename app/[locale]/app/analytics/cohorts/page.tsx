import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import CollectionPage from '@/components/analytics/CollectionPage';
import CohortEditor from '@/components/analytics/CohortEditor';
import { analyticsPage } from '@/lib/analytics/page';
import { recordProjectId } from '@/lib/analytics/guard';
import { requireUser } from '@/lib/session';
import { getCohort, listCohorts } from '@/lib/analytics/records';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.cohorts')} · Analytics` };
}

/** Cohortes del proyecto; ?open=<id> abre su editor arriba de la lista. */
export default async function AnalyticsCohortsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ open?: string }> }) {
  const { locale } = await props.params;
  const { open } = await props.searchParams;
  const ownerProject = open ? await recordProjectId('cohorts', open, (await requireUser(locale)).id) : null;
  const [ctx, t] = await Promise.all([analyticsPage(locale, ownerProject), getTranslations({ locale, namespace: 'analytics.cohorts' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const [cohorts, opened] = await Promise.all([listCohorts(ctx.project.id), open ? getCohort(ctx.project.id, open) : null]);
  const summary = (c: (typeof cohorts)[number]) =>
    [c.definition.properties.length ? t('metaProps', { count: c.definition.properties.length }) : null, c.definition.behavior ? t('metaBehavior', { event: c.definition.behavior.event, days: c.definition.behavior.days }) : null]
      .filter(Boolean)
      .join(' · ');
  return (
    <CollectionPage
      kind="cohorts"
      projectId={ctx.project.id}
      canCreate
      canEdit
      extra={opened ? <CohortEditor projectId={ctx.project.id} cohort={opened} /> : undefined}
      items={cohorts.map((c) => ({ id: c.id, name: c.name, meta: summary(c), href: `/app/analytics/cohorts?open=${c.id}` }))}
    />
  );
}
