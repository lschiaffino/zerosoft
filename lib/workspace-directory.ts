/**
 * Lo que muestra Ajustes › Miembros: personas, invitaciones pendientes y
 * subequipos del workspace, en una forma que sirve igual al server component
 * y a GET /api/teams/members.
 */
import type { TeamRow } from './db';
import { inviteExpired, listPendingInvites, normalizeInviteRole, type TeamRole } from './teams';
import { listTeamPeople, parseApps, type AppAccess, type WorkspaceRole } from './workspace';
import { listGroups } from './workspace-groups';
import { inviteUrl } from './workspace-invites';

export interface MemberDto {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  apps: AppAccess;
  groupIds: string[];
  joinedAt: string;
}

export interface InviteDto {
  id: string;
  email: string;
  role: 'admin' | 'member' | 'guest';
  apps: AppAccess;
  groupIds: string[];
  emailStatus: 'sent' | 'failed' | 'skipped' | '';
  sentAt: string | null;
  sendCount: number;
  expiresAt: string | null;
  expired: boolean;
  createdAt: string;
  /** Link de la invitación (solo para quien puede gestionar). */
  url?: string;
}

export interface GroupDto {
  id: string;
  name: string;
  slug: string;
  color: string;
  description: string;
  memberIds: string[];
  leadIds: string[];
}

export interface DirectoryDto {
  team: { id: string; name: string; ownerId: string; logoUrl: string | null };
  members: MemberDto[];
  invites: InviteDto[];
  groups: GroupDto[];
}

export async function loadDirectory(team: TeamRow, viewerRole: TeamRole, base: string): Promise<DirectoryDto> {
  const admin = viewerRole === 'owner' || viewerRole === 'admin';
  const [people, invites, groups] = await Promise.all([
    listTeamPeople(team, { includeGuests: true }),
    admin ? listPendingInvites(team.id) : Promise.resolve([]),
    listGroups(team.owner_id),
  ]);
  const groupsOf = new Map<string, string[]>();
  for (const g of groups) for (const m of g.members) groupsOf.set(m.user_id, [...(groupsOf.get(m.user_id) ?? []), g.id]);
  return {
    team: { id: team.id, name: team.name, ownerId: team.owner_id, logoUrl: team.logo_url ?? null },
    members: people.map((p) => ({
      userId: p.user_id,
      name: p.name,
      email: p.email,
      image: p.image,
      role: p.role,
      apps: p.apps,
      groupIds: groupsOf.get(p.user_id) ?? [],
      joinedAt: p.created_at,
    })),
    invites: invites.map((i) => {
      let groupIds: string[] = [];
      try {
        const v = JSON.parse(i.group_ids ?? '[]') as unknown;
        groupIds = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      } catch {
        groupIds = [];
      }
      const status = i.email_status === 'sent' || i.email_status === 'failed' || i.email_status === 'skipped' ? i.email_status : '';
      return {
        id: i.id,
        email: i.email,
        role: normalizeInviteRole(i.role),
        apps: parseApps(i.apps),
        groupIds,
        emailStatus: status,
        sentAt: i.last_sent_at ?? null,
        sendCount: Number(i.send_count ?? 0),
        expiresAt: i.expires_at,
        expired: inviteExpired(i),
        createdAt: i.created_at,
        url: inviteUrl(base, i.token, i.locale ?? 'en'),
      };
    }),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      color: g.color,
      description: g.description,
      memberIds: g.members.map((m) => m.user_id),
      leadIds: g.members.filter((m) => m.role === 'lead').map((m) => m.user_id),
    })),
  };
}
