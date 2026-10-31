import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import CollectionPage from '@/components/analytics/CollectionPage';
import { analyticsPage } from '@/lib/analytics/page';
import { listFlags } from '@/lib/analytics/records';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.flags')} · Analytics` };
}

/** Feature flags del proyecto. */
export default async function AnalyticsFlagsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.flags' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const flags = await listFlags(ctx.project.id);
  return (
    <CollectionPage
      kind="flags"
      projectId={ctx.project.id}
      canCreate
      canEdit
      items={flags.map((f) => ({
        id: f.id,
        name: f.name || f.key,
        meta: `${f.name ? `${f.key} · ` : ''}${f.active ? t('on') : t('off')} · ${f.variants.length ? t('multivariateShort', { count: f.variants.length }) : t('rolloutShort', { pct: f.rollout })}`,
        href: `/app/analytics/flags/${f.id}`,
      }))}
    />
  );
}
