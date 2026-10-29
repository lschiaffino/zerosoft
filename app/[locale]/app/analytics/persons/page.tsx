import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import NoProject from '@/components/analytics/NoProject';
import PersonsList from '@/components/analytics/PersonsList';
import { analyticsPage } from '@/lib/analytics/page';
import { listPersons } from '@/lib/analytics/persons';
import { getCohort } from '@/lib/analytics/records';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.persons')} · Analytics` };
}

/** Personas del proyecto (?cohort= para las de una cohorte, ?ids= para las que abandonaron un embudo). */
export default async function AnalyticsPersonsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ cohort?: string; ids?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.persons' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const cohort = sp.cohort ? await getCohort(ctx.project.id, sp.cohort) : null;
  const ids = typeof sp.ids === 'string' ? sp.ids.split(',').filter(Boolean).slice(0, 200) : null;
  const res = await listPersons(ctx.project.id, { cohort: cohort?.definition ?? null, ids });
  return (
    <div className="app-page ui-page an-page">
      <PageHeader
        title={t('title')}
        description={cohort ? t('inCohort', { name: cohort.name }) : ids ? t('dropped', { count: ids.length }) : t('description')}
      />
      <PersonsList
        key={`${ctx.project.id}:${cohort?.id ?? ''}:${sp.ids ?? ''}`}
        projectId={ctx.project.id}
        initial={res.persons}
        initialHasMore={res.hasMore}
        cohortId={cohort?.id ?? null}
        ids={ids ? ids.join(',') : null}
      />
    </div>
  );
}
