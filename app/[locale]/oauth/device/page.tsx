import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import DeviceForm from '@/components/oauth/DeviceForm';
import { requireUser } from '@/lib/session';
import { listMyWorkspaces } from '@/lib/workspace';
import '@/styles/oauth.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.oauth' });
  return { title: t('deviceMetaTitle'), robots: { index: false, follow: false } };
}

/** Login sin navegador en la máquina: la persona escribe acá el código que muestra la CLI. */
export default async function OAuthDevicePage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ code?: string }> }) {
  const { locale } = await props.params;
  const { code } = await props.searchParams;
  const clean = typeof code === 'string' ? code.slice(0, 20) : '';
  const user = await requireUser(locale, `/${locale}/oauth/device${clean ? `?code=${encodeURIComponent(clean)}` : ''}`);
  const real = user.actingUser ?? user;
  const workspaces = await listMyWorkspaces(real);
  return (
    <main className="auth-page oauth-page">
      <div className="auth-card oauth-card">
        <DeviceForm
          initialCode={clean}
          personEmail={real.email}
          workspaces={workspaces.map((w) => ({ teamId: w.teamId, name: w.name, own: w.own }))}
          activeTeamId={real.active_team_id ?? null}
        />
      </div>
    </main>
  );
}
