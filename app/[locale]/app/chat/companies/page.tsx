import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import CompaniesClient from '@/components/chat/CompaniesClient';

export const dynamic = 'force-dynamic';

export default async function ChatCompaniesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  return (
    <div className="ui-page">
      <PageHeader title={t('companies.title')} description={t('companies.sub')} />
      <Suspense fallback={null}>
        <CompaniesClient />
      </Suspense>
    </div>
  );
}
