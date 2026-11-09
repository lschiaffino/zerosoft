import type { Metadata } from 'next';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import { ensureWorkspace } from '@/lib/workspace';
import { loadDirectory } from '@/lib/workspace-directory';
import { loadWorkspaceAppRules } from '@/lib/workspace-apps';
import { isRuleKey } from '@/lib/app-access';
import { APP_SWITCHER_ORDER } from '@/lib/products';
import AppsPanel from '@/components/settings/AppsPanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'apps');
}

/**
 * Ajustes › Apps del workspace: para quién está cada app de equipo (todos,
 * algunos, solo admins o apagada). Lo ven todos; lo cambian owner y admins.
 */
export default async function AppsSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const team = user.workspace ?? (await ensureWorkspace(user.id));
  const admin = isWorkspaceAdmin(user);
  const [rules, dir] = await Promise.all([loadWorkspaceAppRules(team.owner_id), admin ? loadDirectory(team, user.role, '', user.apps ?? '*') : null]);
  const apps = APP_SWITCHER_ORDER.filter((k) => isRuleKey(k));
  return (
    <AppsPanel
      apps={apps}
      initial={rules}
      canEdit={admin}
      people={(dir?.members ?? []).map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role }))}
      teams={(dir?.groups ?? []).map((g) => ({ id: g.id, name: g.name, memberIds: g.memberIds }))}
    />
  );
}
