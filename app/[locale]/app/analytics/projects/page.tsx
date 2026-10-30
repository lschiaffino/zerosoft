import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import CollectionPage from '@/components/analytics/CollectionPage';
import { analyticsPage } from '@/lib/analytics/page';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.projects')} · Analytics` };
}

/** Proyectos del workspace (cada uno con su key pública). Crear, renombrar y borrar: admins. */
export default async function AnalyticsProjectsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.projects' })]);
  return (
    <CollectionPage
      kind="projects"
      projectId={ctx.project?.id ?? null}
      canCreate={ctx.canManage}
      canEdit={ctx.canManage}
      description={ctx.canManage ? t('description') : t('descriptionMember')}
      items={ctx.projects.map((p) => ({ id: p.id, name: p.name, meta: p.public_key, href: `/app/analytics/settings?project=${p.id}` }))}
    />
  );
}
