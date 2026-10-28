import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { realUserId, requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import { ensureWorkspace } from '@/lib/workspace';
import { loadDirectory } from '@/lib/workspace-directory';
import MembersPanel from '@/components/settings/MembersPanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'members');
}

async function base(): Promise<string> {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'zerosoft.ai';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** Ajustes › Miembros: invitar por email, roles, apps permitidas, subequipos y quién sale. Un solo lugar para todas las apps. */
export default async function MembersSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const team = user.workspace ?? (await ensureWorkspace(user.id));
  const dir = await loadDirectory(team, user.role, await base());
  return <MembersPanel initial={dir} me={realUserId(user)} role={user.role} />;
}
