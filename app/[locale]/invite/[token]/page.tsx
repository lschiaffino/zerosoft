import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getDb } from '@/lib/db';
import { DEMO_MODE, getCurrentUser } from '@/lib/session';
import { getInviteByToken, getTeamById, inviteAcceptsEmail, inviteExpired, inviteUsable, normalizeInviteRole } from '@/lib/teams';
import { getMembership } from '@/lib/workspace';
import GoogleButton from '@/components/auth/GoogleButton';
import InviteAccept from '@/components/settings/InviteAccept';
import '@/styles/workspace.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.invite' });
  // El token no va al título ni a la URL canónica; la página no se indexa.
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

function initial(name: string): string {
  return (name.trim().charAt(0) || 'W').toUpperCase();
}

/**
 * Invitación a un workspace: /[locale]/invite/[token]. Sin sesión ofrece
 * entrar con Google (vuelve acá); con sesión, aceptar (y si el email no es
 * el invitado, confirmarlo o cambiar de cuenta). Un link usado, revocado o
 * vencido lo dice y no sirve más.
 */
export default async function InvitePage(props: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.invite' });
  const user = await getCurrentUser();
  const real = user ? (user.actingUser ?? user) : null;

  const invite = await getInviteByToken(token);
  const usable = invite !== null && inviteUsable(invite);
  const team = invite ? await getTeamById(invite.team_id) : null;
  const inviter = invite
    ? ((await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(invite.invited_by)) as { name: string | null; email: string } | undefined)
    : undefined;
  const already = real && team ? await getMembership(team, real.id) : null;
  const role = invite ? normalizeInviteRole(invite.role) : 'member';

  let body;
  if (!invite || !team || invite.kind === 'request' || (!usable && !(already && already.role !== 'guest'))) {
    const expired = invite ? inviteExpired(invite) : false;
    body = (
      <>
        <h1>{expired ? t('expiredTitle') : t('invalidTitle')}</h1>
        <p className="auth-sub">{expired ? t('expiredDesc') : t('invalidDesc')}</p>
        <Link href={user ? '/app' : '/'} className="btn btn-secondary btn-block">
          {user ? t('openApp') : t('backHome')}
        </Link>
      </>
    );
  } else if (already && already.role !== 'guest' && (!usable || role !== 'admin' || already.role === 'admin')) {
    body = (
      <>
        <h1>{t('alreadyTitle', { workspace: team.name })}</h1>
        <p className="auth-sub">{t('alreadyDesc')}</p>
        <Link href="/app" className="btn btn-primary btn-block">
          {t('openApp')}
        </Link>
      </>
    );
  } else {
    const inviterName = inviter?.name?.trim() || inviter?.email || '';
    body = (
      <>
        <h1>{t('title', { workspace: team.name })}</h1>
        <p className="auth-sub">
          {t('sub', { inviter: inviterName })} {t(`roleLine.${role}`)}
        </p>
        {real ? (
          <InviteAccept
            token={token}
            workspace={team.name}
            mismatch={Boolean(invite.email) && invite.email.toLowerCase() !== real.email.toLowerCase()}
            strict={!inviteAcceptsEmail(invite, real.email)}
            inviteEmail={invite.email}
            email={real.email}
            locale={locale}
            demo={DEMO_MODE}
          />
        ) : (
          <>
            <GoogleButton label={t('signinGoogle')} locale={locale} callbackUrl={`/${locale}/invite/${token}`} />
            {invite.email && <p className="auth-legal">{t('useAccount', { email: invite.email })}</p>}
          </>
        )}
        {invite.expires_at && <p className="auth-legal">{t('expires', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(invite.expires_at)) })}</p>}
      </>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-card ws-invite-card">
        {team?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.logo_url} alt="" width={44} height={44} className="ws-logo ws-invite-logo" />
        ) : (
          <span className="ws-logo ws-logo-initial ws-invite-logo" aria-hidden="true">
            {team ? initial(team.name) : '0'}
          </span>
        )}
        {body}
      </div>
    </main>
  );
}
