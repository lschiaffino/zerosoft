import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { parseProfile, suggestTeamName } from '@/lib/onboarding';
import { getOnboardingState } from '@/lib/onboarding-state';
import { joinedWorkspace, listInvitesForEmail } from '@/lib/teams';
import { domainWorkspaces } from '@/lib/workspace';
import { getUserTimeZone } from '@/lib/user-tz';
import { googleOAuthConfigured } from '@/lib/integrations';
import { fakeGoogleCalendarAllowed } from '@/lib/google-calendar-fake';
import { desktopReleaseForClient } from '@/lib/desktop-release';
import WelcomeFlow, { type SetupProps } from '@/components/settings/WelcomeFlow';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.welcome' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Onboarding (/app/welcome), en dos tramos:
 * 1. Perfil: uso personal o en equipo, equipo, vos (nombre y rol), las apps
 *    que vas a usar e invitaciones. Se guarda como borrador en cada paso y al
 *    final marca onboarded_at.
 * 2. Configuración (opcional, se puede saltear entero): conectar cuentas,
 *    importar de la herramienta anterior y la app de escritorio. Lo hecho se
 *    lee de la base (lib/onboarding-state.ts), no de los clics.
 * Quien entró por una invitación: nombre, idioma y zona, y directo al
 * workspace que lo invitó. Quien ya terminó los dos tramos vuelve al inicio.
 */
export default async function WelcomePage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ connected?: string; result?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale, `/${locale}/app/welcome`);
  const real = user.actingUser ?? user;
  const profile = parseProfile(real.profile);

  if (real.onboarded_at) {
    // Segundo tramo: solo para quien pasó por este onboarding y no lo terminó ni salteó.
    if (user.actingUser || (profile.v ?? 0) < 2 || profile.setupDoneAt) redirect(`/${locale}/app`);
    const [state, release] = await Promise.all([
      getOnboardingState(real.id, { workspaceId: user.id, admin: isWorkspaceAdmin(user) }),
      desktopReleaseForClient(),
    ]);
    if (!state) redirect(`/${locale}/app`);
    const step = (key: 'calendar' | 'email' | 'whatsapp') => state.steps.find((s) => s.key === key)!;
    const google = googleOAuthConfigured();
    const setup: SetupProps = {
      step: profile.setupStep ?? 'connect',
      connections: [
        { key: 'calendar', relevant: step('calendar').relevant, done: step('calendar').done, href: google || fakeGoogleCalendarAllowed() ? '/api/integrations/google-calendar/start' : null, settings: step('calendar').href },
        { key: 'email', relevant: step('email').relevant, done: step('email').done, href: google ? '/api/integrations/gmail/start' : null, settings: step('email').href },
        { key: 'whatsapp', relevant: step('whatsapp').relevant, done: step('whatsapp').done, href: null, settings: step('whatsapp').href },
      ],
      sourceTool: state.sourceTool,
      imported: state.steps.find((s) => s.key === 'import')?.done ?? false,
      admin: state.admin,
      release,
      desktopSeen: Boolean(state.desktop.seenAt),
      result: sp.connected && sp.result ? { connected: sp.connected, result: sp.result } : null,
    };
    return (
      <WelcomeFlow
        kind="setup"
        setup={setup}
        workspaceName=""
        name={real.name ?? ''}
        email={real.email}
        timeZone={real.time_zone ?? ''}
        suggestedTeam=""
        pendingInvites={[]}
        domainWorkspaces={[]}
      />
    );
  }

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
      guest={!user.actingUser && joined?.role === 'guest'}
      workspaceId={user.actingUser ? (user.workspace?.id ?? '') : (joined?.id ?? '')}
      name={real.name ?? ''}
      email={real.email}
      timeZone={real.time_zone ?? tz}
      suggestedTeam={suggestTeamName(real.email, '')}
      pendingInvites={pending.map((i) => ({ token: i.token, team: i.team_name, inviter: i.inviter_name || i.inviter_email || '' }))}
      domainWorkspaces={domains.map((d) => ({ id: d.id, name: d.name }))}
      draft={invited ? undefined : profile.draft}
    />
  );
}
