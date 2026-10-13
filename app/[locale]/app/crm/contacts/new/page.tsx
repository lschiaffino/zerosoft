import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import {
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  SOURCES,
  listCompanies,
  listCustomFields,
} from '@/lib/crm';
import ContactForm, { type CustomFieldDef } from '@/components/crm/ContactForm';

export const dynamic = 'force-dynamic';

function parseOptions(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

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
  // Sin parámetros, /new abre el alta rápida (modal) sobre la lista; el
  // formulario completo queda en /new?full=1 o con contexto (companyId…).
  if (!searchParams.full && !searchParams.companyId) redirect(`/${locale}/app/crm/contacts?new=1`);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const companies = (await listCompanies(user.id, { pageSize: 100, sort: 'name' })).rows.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const customFields: CustomFieldDef[] = (await listCustomFields(user.id, 'contacts')).map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    options: parseOptions(f.options),
  }));

  const defaultCompanyId =
    searchParams.companyId && companies.some((c) => c.id === searchParams.companyId)
      ? searchParams.companyId
      : undefined;

  return (
    <div className="app-page narrow">
      <Link href="/app/crm/contacts" className="mono back-link">
        {t('contacts.detail.back')}
      </Link>
      <h1 className="app-title">{t('contacts.newTitle')}</h1>
      <ContactForm
        companies={companies}
        customFields={customFields}
        lifecycles={[...LIFECYCLE_STAGES]}
        leadStatuses={[...LEAD_STATUSES]}
        sources={[...SOURCES]}
        defaultCompanyId={defaultCompanyId}
      />
    </div>
  );
}
