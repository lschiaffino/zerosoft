import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import { requireUser } from '@/lib/session';
import { createFormData } from '@/lib/crm-create-form';
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

  const user = await requireUser(locale);
  // Sin parámetros, /new abre el alta rápida (modal) sobre la lista; el
  // formulario completo queda en /new?full=1 o con contexto (companyId…).
  if (Object.keys(searchParams).length === 0) redirect(`/${locale}/app/crm/companies?new=1`);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const createForm = await createFormData(user, 'companies', { more: true });

  return (
    <div className="ui-page ui-page-narrow">
      <PageHeader back={{ href: '/app/crm/companies', label: t('record.back.companies') }} title={t('companies.newTitle')} />
      <CompanyForm form={createForm.fields} more={createForm.more} people={createForm.people} me={createForm.me} />
    </div>
  );
}
