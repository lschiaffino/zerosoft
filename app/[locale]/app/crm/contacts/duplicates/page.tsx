import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import DuplicatesPanel from '@/components/crm/DuplicatesPanel';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
}

/** Contactos de todo el workspace que comparten email, para fusionarlos (lib/crm-contact-email.ts). */
export default async function ContactDuplicatesPage(props: Props) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  return (
    <div className="ui-page crm-list-page">
      <PageHeader
        back={{ href: '/app/crm/contacts', label: t('record.back.contacts') }}
        title={t('contacts.dupes.title')}
        description={t('contacts.dupes.description')}
      />
      <DuplicatesPanel />
    </div>
  );
}
