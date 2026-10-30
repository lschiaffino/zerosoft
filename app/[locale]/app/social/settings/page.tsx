import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import SettingsView from '@/components/social/SettingsView';
import { requireUser } from '@/lib/session';
import { isSocialAdmin, listSocialPeople, networkStatuses, oauthRedirectUri, socialActor } from '@/lib/social';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('settings.title') };
}

/** Ajustes de Social: roles (publica solo o necesita aprobación) y apps de desarrollador de la instancia. */
export default async function SocialSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const actor = socialActor(user);
  const admin = isSocialAdmin(actor);
  const people = admin ? await listSocialPeople(actor) : [];
  const redirectUri = oauthRedirectUri();
  return (
    <div className="ui-page">
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <SettingsView people={people} networks={networkStatuses()} admin={admin} redirectUri={redirectUri} webhookUrl={redirectUri.replace('/oauth/callback', '/webhooks/meta')} />
    </div>
  );
}
