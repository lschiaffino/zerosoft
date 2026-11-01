import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Logo from '@/components/brand/Logo';
import ConsentForm from '@/components/oauth/ConsentForm';
import { getClient, isLoopbackHost, openAuthRequest } from '@/lib/oauth/store';
import { requireUser } from '@/lib/session';
import { listMyWorkspaces } from '@/lib/workspace';
import '@/styles/oauth.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.oauth' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Pantalla de permisos: pasa por el login normal y solo lee. Lo que decide es POST /api/oauth/consent. */
export default async function OAuthConsentPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ request?: string }> }) {
  const { locale } = await props.params;
  const { request } = await props.searchParams;
  const t = await getTranslations({ locale, namespace: 'settings.oauth' });
  const returnTo = `/${locale}/oauth/consent?request=${encodeURIComponent(request ?? '')}`;
  const user = await requireUser(locale, returnTo);
  const real = user.actingUser ?? user;
  const pending = request ? await openAuthRequest(request) : null;
  const client = pending ? await getClient(pending.client_id) : null;
  if (!pending || !client) {
    return (
      <main className="auth-page oauth-page">
        <div className="auth-card oauth-card">
          <Logo variant="symbol" tone="current" height={32} title="zerosoft" />
          <h1>{t('expiredTitle')}</h1>
          <p className="auth-sub">{t('expiredBody')}</p>
        </div>
      </main>
    );
  }
  const workspaces = await listMyWorkspaces(real);
  return (
    <main className="auth-page oauth-page">
      <div className="auth-card oauth-card">
        <Logo variant="symbol" tone="current" height={32} title="zerosoft" />
        <ConsentForm
          mode="code"
          target={pending.id}
          clientName={client.name}
          redirectHost={isLoopbackHost(new URL(pending.redirect_uri).hostname) ? null : new URL(pending.redirect_uri).host}
          askedScope={pending.scope}
          personEmail={real.email}
          workspaces={workspaces.map((w) => ({ teamId: w.teamId, name: w.name, own: w.own }))}
          activeTeamId={real.active_team_id ?? null}
        />
      </div>
    </main>
  );
}
