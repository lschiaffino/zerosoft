import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import { requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import {
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  SOURCES,
  listCompanies,
  listCustomFields,
} from '@/lib/crm';
import ContactForm, { type CustomFieldDef } from '@/components/crm/ContactForm';
import { listMembers } from '@/lib/teams';

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
  const scope = await sessionScope(user);
  // Sin parámetros, /new abre el alta rápida (modal) sobre la lista; el
  // formulario completo queda en /new?full=1 o con contexto (companyId…).
  if (!searchParams.full && !searchParams.companyId) redirect(`/${locale}/app/crm/contacts?new=1`);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const companies = (await listCompanies(user.id, { pageSize: 100, sort: 'name', ownerScope: scope })).rows.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const members = user.team?.id
    ? await listMembers(user.team.id)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null }];
  const people = members.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));
  const customFields: CustomFieldDef[] = (await listCustomFields(user.id, 'contacts')).map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    options: parseOptions(f.options),
    ...(f.type === 'user' ? { choices: people } : {}),
  }));

  const defaultCompanyId =
    searchParams.companyId && companies.some((c) => c.id === searchParams.companyId)
      ? searchParams.companyId
      : undefined;

  return (
    <div className="ui-page ui-page-narrow">
      <PageHeader back={{ href: '/app/crm/contacts', label: t('record.back.contacts') }} title={t('contacts.newTitle')} />
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
