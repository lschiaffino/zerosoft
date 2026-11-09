import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import { GroupsPage } from '@/components/analytics/DataPages';
import { analyticsPage } from '@/lib/analytics/page';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.groups')} · Pulse` };
}

function parse(raw: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw ?? '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Grupos del proyecto (lo que llegó con zs.group), los últimos 500. */
export default async function AnalyticsGroupsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.groups' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const rows = (await getDb()
    .prepare('SELECT group_type, group_key, properties, updated_at FROM analytics_groups WHERE project_id = ? ORDER BY updated_at DESC LIMIT 500')
    .all(ctx.project.id)) as Array<{ group_type: string; group_key: string; properties: string; updated_at: number }>;
  return <GroupsPage key={ctx.project.id} groups={rows.map((r) => ({ type: r.group_type, key: r.group_key, properties: parse(r.properties), updatedAt: Number(r.updated_at) }))} />;
}
