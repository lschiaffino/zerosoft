import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { LIFECYCLE_STAGES } from '@/lib/crm';
import CompanyForm from '@/components/crm/CompanyForm';

export const dynamic = 'force-dynamic';

export default async function NewCompanyPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const lifecycles = LIFECYCLE_STAGES.map((value) => ({ value, label: t(`enums.lifecycle.${value}`) }));

  return (
    <div className="app-page narrow">
      <div>
        <Link href="/app/crm/companies" className="back-link">
          {t('companies.detail.back')}
        </Link>
        <h1 className="app-title">{t('companies.newCta')}</h1>
      </div>
      <div className="panel">
        <CompanyForm lifecycles={lifecycles} />
      </div>
    </div>
  );
}
