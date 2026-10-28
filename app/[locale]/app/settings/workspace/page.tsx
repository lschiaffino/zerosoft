import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import { emailDomain, ensureWorkspace, joinSettings, parseDomains, workspaceModeOf } from '@/lib/workspace';
import WorkspacePanel from '@/components/settings/WorkspacePanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'workspace');
}

/**
 * Ajustes › Workspace: la ficha del workspace activo (nombre, logo,
 * identificador, modo, tamaño y dominios). Lo que vivía acá antes se mudó a
 * su sección; los anchors viejos (#api, #webhooks, #ai, #credentials) los
 * redirige PlatformSettingsNav.
 */
export default async function WorkspaceSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const team = user.workspace ?? (await ensureWorkspace(user.id));
  const owner = (await getDb().prepare('SELECT email FROM users WHERE id = ?').get(team.owner_id)) as { email: string } | undefined;
  return (
    <WorkspacePanel
      canEdit={isWorkspaceAdmin(user)}
      initial={{
        id: team.id,
        name: team.name,
        slug: team.slug ?? null,
        logoUrl: team.logo_url ?? null,
        mode: workspaceModeOf(team),
        size: team.size ?? null,
        allowedDomains: parseDomains(team.allowed_domains),
        ownerEmail: owner?.email ?? '',
        joinApps: joinSettings(team).apps,
        joinApproval: joinSettings(team).approval,
        editorDomain: emailDomain((user.actingUser ?? user).email),
      }}
    />
  );
}
