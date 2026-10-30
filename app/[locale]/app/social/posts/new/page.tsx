import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import Composer from '@/components/social/Composer';
import { requireUser, userCanUseApp } from '@/lib/session';
import { listAccounts, listLibrary, socialActor, socialRoleOf } from '@/lib/social';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('compose.title') };
}

/** Compositor: una publicación para varias cuentas, con texto propio por red. ?date= y ?account= la precargan. */
export default async function SocialComposePage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ date?: string; account?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const actor = socialActor(user);
  const [accounts, library, role] = await Promise.all([listAccounts(actor), listLibrary(actor), socialRoleOf(actor)]);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null;
  return (
    <div className="ui-page">
      <PageHeader title={t('compose.title')} description={role === 'drafter' ? t('compose.drafterNote') : undefined} back={{ href: '/app/social', label: t('sidebar.calendar') }} />
      <Composer
        accounts={accounts}
        post={null}
        library={library}
        canShorten={userCanUseApp(user, 'link')}
        drafter={role === 'drafter'}
        initialDate={date}
        initialAccountId={accounts.some((a) => a.id === sp.account) ? sp.account : null}
      />
    </div>
  );
}
