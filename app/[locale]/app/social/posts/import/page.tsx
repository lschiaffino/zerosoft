import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import BulkImport from '@/components/social/BulkImport';
import { requireUser } from '@/lib/session';
import { listAccounts, socialActor, socialRoleOf } from '@/lib/social';
import { getUserTimeZone } from '@/lib/user-tz';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('bulk.title') };
}

/** Programación masiva: un CSV con fecha, hora, texto y link, a las cuentas elegidas. */
export default async function SocialBulkImportPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const actor = socialActor(user);
  const [accounts, role, tz] = await Promise.all([listAccounts(actor), socialRoleOf(actor), getUserTimeZone()]);
  return (
    <div className="ui-page">
      <PageHeader title={t('bulk.title')} description={t('bulk.description')} back={{ href: '/app/social/posts', label: t('sidebar.posts') }} />
      <BulkImport accounts={accounts} tz={tz} drafter={role === 'drafter'} dayFirstDefault={locale !== 'en'} />
    </div>
  );
}
