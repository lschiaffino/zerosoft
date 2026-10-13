import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { LIFECYCLE_STAGES } from '@/lib/crm';
import CompanyForm from '@/components/crm/CompanyForm';

export const dynamic = 'force-dynamic';

export default async function NewCompanyPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;

  const {
    locale
  } = params;

  await requireUser(locale);
  // Sin parámetros, /new abre el alta rápida (modal) sobre la lista; el
  // formulario completo queda en /new?full=1 o con contexto (companyId…).
  if (Object.keys(searchParams).length === 0) redirect(`/${locale}/app/crm/companies?new=1`);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const lifecycles = LIFECYCLE_STAGES.map((value) => ({ value, label: t(`enums.lifecycle.${value}`) }));

  return (
    <div className="app-page narrow">
      <Link href="/app/crm/companies" className="mono back-link">
        {t('companies.detail.back')}
      </Link>
      <h1 className="app-title">{t('companies.newTitle')}</h1>
      <CompanyForm lifecycles={lifecycles} />
    </div>
  );
}
