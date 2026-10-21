import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import CompanyDuplicatesPanel from '@/components/crm/CompanyDuplicatesPanel';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
}

/** Empresas duplicadas de todo el workspace (por dominio o nombre), para fusionarlas. */
export default async function CompanyDuplicatesPage(props: Props) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  return (
    <div className="ui-page crm-list-page">
      <PageHeader
        back={{ href: '/app/crm/companies', label: t('record.back.companies') }}
        title={t('companies.dupes.title')}
        description={t('companies.dupes.description')}
      />
      <CompanyDuplicatesPanel />
    </div>
  );
}
