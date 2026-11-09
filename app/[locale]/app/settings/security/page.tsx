import type { Metadata } from 'next';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import { getUserById } from '@/lib/db';
import { listSessions, listUserSecurityEvents, listWorkspaceSecurityEvents, membersWithoutMfa, recoveryCodesLeft } from '@/lib/account-security';
import SecuritySettings from '@/components/settings/SecuritySettings';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'security');
}

/**
 * Ajustes › Seguridad: verificación en dos pasos y sesiones de la persona; para owner y
 * admins, la exigencia de dos pasos y el registro de seguridad del workspace.
 */
export default async function SecuritySettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const meId = realUserId(user);
  const admin = Boolean(user.workspace) && isWorkspaceAdmin(user) && !user.mfaRequiredBy;
  const [me, sessions, activity, recoveryLeft, events, withoutMfa] = await Promise.all([
    getUserById(meId),
    listSessions(meId, user.sid ?? null),
    listUserSecurityEvents(meId, 20),
    recoveryCodesLeft(meId),
    admin ? listWorkspaceSecurityEvents(user.workspace!.id, { limit: 50 }) : Promise.resolve(null),
    admin ? membersWithoutMfa(user.workspace!.id) : Promise.resolve(null),
  ]);
  return (
    <SecuritySettings
      locale={locale}
      mfaEnabledAt={me?.mfa_enabled_at ?? null}
      recoveryLeft={recoveryLeft}
      requiredBy={user.mfaRequiredBy ?? null}
      sessions={sessions}
      activity={activity}
      workspace={
        admin
          ? {
              id: user.workspace!.id,
              name: user.workspace!.name,
              isOwner: user.role === 'owner',
              requireMfa: Boolean(user.workspace!.require_mfa),
              withoutMfa: withoutMfa ?? [],
              events: events ?? [],
            }
          : null
      }
    />
  );
}
