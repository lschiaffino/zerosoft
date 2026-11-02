import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import CollectionPage from '@/components/analytics/CollectionPage';
import { analyticsPage } from '@/lib/analytics/page';
import { listActions } from '@/lib/analytics/records-more';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.actions')} · Analytics` };
}

/** Acciones: un nombre para uno o varios eventos, para usar en insights. */
export default async function AnalyticsActionsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.actions' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const actions = await listActions(ctx.project.id);
  return (
    <CollectionPage
      kind="actions"
      projectId={ctx.project.id}
      canCreate
      canEdit
      items={actions.map((a) => ({ id: a.id, name: a.name, meta: a.steps.map((s) => s.event).slice(0, 3).join(', '), href: `/app/analytics/actions/${a.id}` }))}
    />
  );
}
