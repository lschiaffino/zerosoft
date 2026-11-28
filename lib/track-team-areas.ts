/**
 * Track — roles por team: lo que no depende de la base (áreas, permisos por
 * defecto y qué puede cada uno). Lo usan la UI, lib/track-team-roles y los tests.
 */

export const TEAM_AREAS = ['settings', 'labels', 'templates', 'members'] as const;
export type TeamArea = (typeof TEAM_AREAS)[number];
export type TeamPermissionMode = 'members' | 'owners';
export type TeamPermissions = Record<TeamArea, TeamPermissionMode>;

/**
 * Todo team arranca con sus ajustes en manos de sus dueños y de los admins del
 * workspace (también los de antes de los roles, con team_permissions NULL). Un
 * dueño puede abrir un área a cualquier miembro.
 */
export const DEFAULT_TEAM_PERMISSIONS: TeamPermissions = {
  settings: 'owners',
  labels: 'owners',
  templates: 'owners',
  members: 'owners',
};

/** Lo guardado en track_projects.team_permissions, completado con los valores por defecto. */
export function parseTeamPermissions(raw: string | null | undefined): TeamPermissions {
  const out: TeamPermissions = { ...DEFAULT_TEAM_PERMISSIONS };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    for (const area of TEAM_AREAS) {
      if (v?.[area] === 'members' || v?.[area] === 'owners') out[area] = v[area] as TeamPermissionMode;
    }
  } catch {
    // JSON roto: los valores por defecto.
  }
  return out;
}

export interface TeamCapabilities {
  /** Dueño del team (o admin del workspace): lo que es solo de dueños. */
  owner: boolean;
  /** Es dueño por el rol del team (no por ser admin). */
  teamOwner: boolean;
  settings: boolean;
  labels: boolean;
  templates: boolean;
  members: boolean;
}

/** Lo que puede cada uno sin depender de la base: útil para tests y para la UI. */
export function capabilitiesFor(opts: { workspaceAdmin: boolean; teamOwner: boolean; permissions: TeamPermissions }): TeamCapabilities {
  const owner = opts.workspaceAdmin || opts.teamOwner;
  const area = (a: TeamArea) => owner || opts.permissions[a] === 'members';
  return { owner, teamOwner: opts.teamOwner, settings: area('settings'), labels: area('labels'), templates: area('templates'), members: area('members') };
}

/** Lo que puede alguien sin datos del team: solo lo que le da ser admin. */
export function adminOnlyCapabilities(workspaceAdmin: boolean): TeamCapabilities {
  return capabilitiesFor({ workspaceAdmin, teamOwner: false, permissions: DEFAULT_TEAM_PERMISSIONS });
}
