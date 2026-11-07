import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import LlmPage from '@/components/analytics/LlmPage';
import NoProject from '@/components/analytics/NoProject';
import { analyticsPage } from '@/lib/analytics/page';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analyticsMore' });
  return { title: `${t('sidebar.llm')} · Analytics` };
}

/** LLM: generaciones que informa el cliente. */
export default async function AnalyticsLlmPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analyticsMore.llm' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  return <LlmPage key={ctx.project.id} projectId={ctx.project.id} publicKey={ctx.project.public_key} />;
}
