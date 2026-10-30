import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { suggestTeamName } from '@/lib/onboarding';
import { joinedWorkspace, listInvitesForEmail } from '@/lib/teams';
import { domainWorkspaces } from '@/lib/workspace';
import { getUserTimeZone } from '@/lib/user-tz';
import WelcomeFlow from '@/components/settings/WelcomeFlow';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.welcome' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Onboarding (/app/welcome): primer ingreso. Cuenta nueva: uso personal o en
 * equipo, equipo e invitaciones, rol, herramienta de origen y app de
 * entrada. Quien entró por una invitación: nombre, idioma y zona, y directo
 * al workspace que lo invitó. Quien ya lo terminó vuelve al inicio.
 */
export default async function WelcomePage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale, `/${locale}/app/welcome`);
  const real = user.actingUser ?? user;
  if (real.onboarded_at) redirect(`/${locale}/app`);
  // Invitado = ya es parte de un workspace ajeno (member, admin o guest), venga o no con ?invited=1.
  const joined = user.actingUser ? null : await joinedWorkspace(real.id);
  const invited = Boolean(user.actingUser) || joined !== null;
  const [pending, domains, tz] = await Promise.all([
    invited ? Promise.resolve([]) : listInvitesForEmail(real.email),
    invited ? Promise.resolve([]) : domainWorkspaces(real),
    getUserTimeZone(),
  ]);
  return (
    <WelcomeFlow
      kind={invited ? 'invited' : 'full'}
      workspaceName={user.actingUser ? (user.workspace?.name ?? '') : (joined?.name ?? '')}
      name={real.name ?? ''}
      email={real.email}
      timeZone={real.time_zone ?? tz}
      suggestedTeam={suggestTeamName(real.email, '')}
      pendingInvites={pending.map((i) => ({ token: i.token, team: i.team_name, inviter: i.inviter_name || i.inviter_email || '' }))}
      domainWorkspaces={domains.map((d) => ({ id: d.id, name: d.name }))}
    />
  );
}
