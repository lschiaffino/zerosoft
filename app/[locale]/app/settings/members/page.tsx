import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { isWorkspaceAdmin, realUserId, requireUser, userCanUseApp } from '@/lib/session';
import { featuredApps, moreAppsByCategory } from '@/lib/workspace-mode';
import { isAlwaysOnApp } from '@/lib/products';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import { ensureWorkspace, listMyWorkspaces, workspaceModeOf } from '@/lib/workspace';
import { loadDirectory } from '@/lib/workspace-directory';
import { getTeamById, listGuestWorkspaces } from '@/lib/teams';
import RequestWorkspaceNotice from '@/components/settings/RequestWorkspaceNotice';
import GuestOfPanel from '@/components/settings/GuestOfPanel';
import MembersPanel from '@/components/settings/MembersPanel';
import { emailLoginEnabled } from '@/lib/email-login';

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
export default async function MembersSettingsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ person?: string; ws?: string }> }) {
  const { locale } = await props.params;
  const { person, ws } = await props.searchParams;
  const user = await requireUser(locale);
  const team = user.workspace ?? (await ensureWorkspace(user.id));
  const dir = await loadDirectory(team, user.role, await base(), user.apps ?? '*', realUserId(user));
  // Owner de antes de 128 (onboarded_at = created_at) con un workspace nuevo: lo que tenía
  // solo para él (Track, Chat…) lo va a ver quien entre. Se avisa al invitar.
  const owner = (await getDb().prepare('SELECT created_at, onboarded_at FROM users WHERE id = ?').get(team.owner_id)) as
    | { created_at: string; onboarded_at: string | null }
    | undefined;
  const legacyNotice = user.role === 'owner' && team.keyed_by === 'owner' && Boolean(owner && owner.onboarded_at === owner.created_at);
  const real = user.actingUser ?? user;
  const guestOf = await listGuestWorkspaces(realUserId(user));
  // Aviso de "pide acceso" (?person=&ws=): su acceso solo se abre en el workspace del pedido.
  // Lo que no se pueda abrir lo dice: el link nunca queda mudo.
  const admin = isWorkspaceAdmin(user);
  let openPerson: string | null = null;
  let other: { teamId: string | null; workspace: string; reason: 'switch' | 'notPart' | 'removed' | 'adminOnly' | 'adminsOnly' } | null = null;
  if (person) {
    if (!ws || ws !== team.id) {
      const own = await ensureWorkspace(real.id);
      const entry = !ws ? null : ws === own.id ? { teamId: null } : (await listMyWorkspaces(real)).find((e) => e.teamId === ws);
      const target = entry && ws ? await getTeamById(ws) : null;
      other = entry && target ? { teamId: entry.teamId, workspace: target.name, reason: 'switch' } : { teamId: null, workspace: '', reason: 'notPart' };
    } else {
      const target = dir.members.find((m) => m.userId === person);
      if (!admin) other = { teamId: null, workspace: team.name, reason: 'adminsOnly' };
      else if (!target) other = { teamId: null, workspace: team.name, reason: 'removed' };
      else if (target.role === 'owner' || (target.role === 'admin' && user.role !== 'owner') || person === real.id) other = { teamId: null, workspace: team.name, reason: 'adminOnly' };
      else openPerson = person;
    }
  }
  const mode = workspaceModeOf(team);
  // Inbox es personal: no se habilita por miembro.
  const appOrder = [...featuredApps({ mode }), ...moreAppsByCategory({ mode }).flatMap((g) => g.apps)].filter((k) => !isAlwaysOnApp(k));
  return (
    <>
      {other && <RequestWorkspaceNotice {...other} />}
      <GuestOfPanel workspaces={guestOf} />
      <MembersPanel openPerson={openPerson} actorApps={user.apps ?? '*'} appOrder={appOrder} initial={dir} me={realUserId(user)} role={user.role} legacyNotice={legacyNotice} peopleLinks={userCanUseApp(user, 'people')} emailLogin={emailLoginEnabled()} />
    </>
  );
}
