import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getCurrentUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { getInviteByToken, getTeamById, inviteUsable } from '@/lib/teams';
import GoogleButton from '@/components/auth/GoogleButton';
import InviteJoin from '@/components/crm/InviteJoin';

export const dynamic = 'force-dynamic';

/** Página de aceptación de invite: /[locale]/invite/[token]. */
export default async function InvitePage({
  params: { locale, token },
}: {
  params: { locale: string; token: string };
}) {
  const t = await getTranslations({ locale, namespace: 'crm' });
  const user = await getCurrentUser();

  const invite = await getInviteByToken(token);
  const usable = invite !== null && inviteUsable(invite);
  const team = usable && invite ? await getTeamById(invite.team_id) : null;
  const ownerEmail = team
    ? (((
        await getDb().prepare('SELECT email FROM users WHERE id = ?').get(team.owner_id)
      ) as { email: string } | undefined)?.email ?? '')
    : '';

  return (
    <main className="auth-page">
      <div className="auth-card">
        <span className="brand-zero" style={{ width: 44, height: 44, fontSize: 20 }}>
          0
        </span>
        {!usable || !team ? (
          <>
            <h1>{t('invite.invalidTitle')}</h1>
            <p className="auth-sub">{t('invite.invalidDesc')}</p>
            <p className="auth-sub" style={{ marginTop: 18 }}>
              <Link href="/">{t('invite.backHome')}</Link>
            </p>
          </>
        ) : (
          <>
            <h1>{t('invite.title', { team: team.name })}</h1>
            <p className="auth-sub">{t('invite.sub', { email: ownerEmail })}</p>
            {user ? (
              <InviteJoin token={token} />
            ) : (
              <>
                <p className="auth-sub" style={{ marginBottom: 12 }}>
                  {t('invite.signinToJoin')}
                </p>
                <GoogleButton
                  label={t('invite.signinGoogle')}
                  locale={locale}
                  callbackUrl={`/${locale}/invite/${token}`}
                />
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
