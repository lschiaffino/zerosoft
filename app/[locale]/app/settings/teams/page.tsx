import type { Metadata } from 'next';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import { ensureWorkspace } from '@/lib/workspace';
import { loadDirectory } from '@/lib/workspace-directory';
import TeamsPanel from '@/components/settings/TeamsPanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'teams');
}

/** Ajustes › Equipos: los subequipos del workspace, compartidos por todas las apps. */
export default async function TeamsSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const team = user.workspace ?? (await ensureWorkspace(user.id));
  const dir = await loadDirectory(team, user.role, '');
  return <TeamsPanel initial={dir.groups} people={dir.members} canEdit={isWorkspaceAdmin(user)} />;
}
