import { pendingRequests } from './workspace-access-request';
import type { ProductKey } from './products';
/**
 * Lo que muestra Ajustes › Miembros: personas, invitaciones pendientes y
 * subequipos del workspace, en una forma que sirve igual al server component
 * y a GET /api/teams/members.
 */
import type { TeamInviteRow, TeamRow } from './db';
import { inviteExpired, listPendingInvites, normalizeInviteRole, type TeamRole } from './teams';
import { canGrantApps, listTeamPeople, parseApps, type AppAccess, type WorkspaceRole } from './workspace';
import { listGroups } from './workspace-groups';
import { inviteUrl } from './workspace-invites';
import { lastActiveByPerson, listAudit, listDeactivated, type AuditEntry, type DeactivatedDto } from './workspace-admin';

export interface MemberDto {
  /** Apps que pidió y nadie respondió todavía (solo se cargan para admins). */
  requestedApps: ProductKey[];
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  apps: AppAccess;
  groupIds: string[];
  joinedAt: string;
  /** Última vez que usó el workspace (null = nunca o antes de que se registrara). */
  lastActiveAt: string | null;
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
  /** 'request' = alguien pidió entrar por dominio y espera aprobación. */
  kind: 'invite' | 'request';
  /** Se puede aceptar con otro email (el admin lo permitió al reenviar). */
  anyEmail: boolean;
  /** Puede reenviarla (ve el link): la podría haber hecho. */
  canResend: boolean;
  /** Puede revocarla: la podría haber hecho (los pedidos de ingreso, cualquier admin). */
  canRevoke: boolean;
  /** Puede abrirla a otro email: quien la hizo o el owner. */
  canAllowAnyEmail: boolean;
}

export interface GroupDto {
  id: string;
  name: string;
  slug: string;
  color: string;
  description: string;
  memberIds: string[];
  leadIds: string[];
  /** Apps que lo usan (opt-in): crm, chat, groups. */
  apps: string[];
}

export interface DirectoryDto {
  team: { id: string; name: string; ownerId: string; logoUrl: string | null };
  members: MemberDto[];
  invites: InviteDto[];
  groups: GroupDto[];
  /** Personas desactivadas que se pueden reactivar (solo para admins). */
  deactivated: DeactivatedDto[];
  /** Últimos cambios de permisos (solo para admins). */
  audit: AuditEntry[];
}

/**
 * ¿Esta persona puede reenviar una invitación o ver su link? Solo si podría
 * haberla hecho: un admin no maneja invitaciones de admins ni con apps que no tiene.
 */
export function canHandleInvite(role: TeamRole, apps: AppAccess, invite: Pick<TeamInviteRow, 'role' | 'apps'>): boolean {
  if (role === 'owner') return true;
  if (normalizeInviteRole(invite.role) === 'admin') return false;
  return normalizeInviteRole(invite.role) === 'guest' || canGrantApps(apps, parseApps(invite.apps));
}

export async function loadDirectory(team: TeamRow, viewerRole: TeamRole, base: string, viewerApps: AppAccess = '*', viewerId?: string): Promise<DirectoryDto> {
  const admin = viewerRole === 'owner' || viewerRole === 'admin';
  const [people, invites, groups, requests, lastActive, deactivated, audit] = await Promise.all([
    listTeamPeople(team, { includeGuests: true }),
    admin ? listPendingInvites(team.id) : Promise.resolve([]),
    listGroups(team.owner_id),
    admin ? pendingRequests(team.id) : Promise.resolve(new Map<string, ProductKey[]>()),
    lastActiveByPerson(team.id),
    admin ? listDeactivated(team.id) : Promise.resolve([]),
    admin ? listAudit(team.id, { limit: 50 }).catch(() => []) : Promise.resolve([]),
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
      lastActiveAt: lastActive.get(p.user_id) ?? null,
      requestedApps: requests.get(p.user_id) ?? [],
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
        url: i.kind === 'request' || !canHandleInvite(viewerRole, viewerApps, i) ? undefined : inviteUrl(base, i.token, i.locale ?? 'en'),
        canResend: i.kind !== 'request' && Boolean(i.email) && canHandleInvite(viewerRole, viewerApps, i),
        canRevoke: i.kind === 'request' || canHandleInvite(viewerRole, viewerApps, i),
        canAllowAnyEmail: i.kind !== 'request' && Boolean(i.email) && normalizeInviteRole(i.role) !== 'admin' && (viewerRole === 'owner' || (i.invited_by === viewerId && canHandleInvite(viewerRole, viewerApps, i))),
        kind: i.kind === 'request' ? 'request' : 'invite',
        anyEmail: Number(i.any_email ?? 0) === 1,
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
      apps: g.apps,
    })),
    deactivated,
    audit,
  };
}
