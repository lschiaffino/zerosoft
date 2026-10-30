import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import AccountsView from '@/components/social/AccountsView';
import { requireUser } from '@/lib/session';
import { isSocialAdmin, listAccounts, listSocialPeople, networkStatuses, socialActor } from '@/lib/social';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('accounts.title') };
}

/** Cuentas conectadas, quién publica en cada una, horarios de la cola y redes para conectar. */
export default async function SocialAccountsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ connected?: string; count?: string; error?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const actor = socialActor(user);
  const admin = isSocialAdmin(actor);
  const [accounts, people] = await Promise.all([listAccounts(actor), admin ? listSocialPeople(actor) : Promise.resolve([])]);
  return (
    <div className="ui-page">
      <PageHeader title={t('accounts.title')} description={admin ? t('accounts.descriptionAdmin') : t('accounts.descriptionMember')} />
      <AccountsView
        accounts={accounts}
        networks={networkStatuses()}
        people={people.map((p) => ({ id: p.id, name: p.name, socialRole: p.socialRole }))}
        admin={admin}
        flash={{ connected: sp.connected?.slice(0, 20), count: sp.count?.slice(0, 4), error: sp.error?.slice(0, 40) }}
      />
    </div>
  );
}
