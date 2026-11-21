import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import { requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listCompanies } from '@/lib/crm';
import { createFormData } from '@/lib/crm-create-form';
import ContactForm from '@/components/crm/ContactForm';

export const dynamic = 'force-dynamic';

export default async function NewContactPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ companyId?: string; full?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  // Sin parámetros, /new abre el alta rápida (modal) sobre la lista; el
  // formulario completo queda en /new?full=1 o con contexto (companyId…).
  if (!searchParams.full && !searchParams.companyId) redirect(`/${locale}/app/crm/contacts?new=1`);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const companies = (await listCompanies(user.id, { pageSize: 100, sort: 'name', ownerScope: scope })).rows.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const createForm = await createFormData(user, 'contacts', { more: true });

  const defaultCompanyId =
    searchParams.companyId && companies.some((c) => c.id === searchParams.companyId)
      ? searchParams.companyId
      : undefined;

  return (
    <div className="ui-page ui-page-narrow">
      <PageHeader back={{ href: '/app/crm/contacts', label: t('record.back.contacts') }} title={t('contacts.newTitle')} />
      <ContactForm
        companies={companies}
        form={createForm.fields}
        more={createForm.more}
        people={createForm.people}
        me={createForm.me}
        defaultCompanyId={defaultCompanyId}
      />
    </div>
  );
}
