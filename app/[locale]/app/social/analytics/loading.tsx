import { getTranslations } from 'next-intl/server';
import AnalyticsSkeleton from '@/components/analytics-kit/Skeleton';
import '@/styles/analytics-kit.css';

export default async function Loading() {
  const t = await getTranslations('analyticsKit');
  return <AnalyticsSkeleton label={t('loading')} />;
}
