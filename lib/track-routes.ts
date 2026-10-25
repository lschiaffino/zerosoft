/**
 * Track — rutas con el vocabulario de Linear. Un proyecto de Track (con clave,
 * estados y cycles) es un team: /app/track/team/WEB. Los projects de Linear
 * (en el código `plans`) viven en /app/track/projects/<id>. Las rutas viejas
 * (/app/track/projects/<id de team>, /app/track/plans) redirigen.
 */
export const TEAMS_PATH = '/app/track/teams';
export const NEW_TEAM_PATH = '/app/track/teams/new';
export const PROJECTS_PATH = '/app/track/projects';

/** Página del team por su clave (WEB) o, si no se tiene, por su id. */
export function teamPath(team: { id: string; slug?: string | null } | string): string {
  const key = typeof team === 'string' ? team : team.slug ? team.slug.toUpperCase() : team.id;
  return `/app/track/team/${encodeURIComponent(key)}`;
}

/** Página de un project de Linear (plan). */
export function projectPath(planId: string): string {
  return `${PROJECTS_PATH}/${encodeURIComponent(planId)}`;
}

/** Clave del team de un issue (WEB-12 → WEB), o su id si no hay identificador. */
export function teamKeyOf(issue: { project_id: string; identifier?: string | null }): string {
  const m = issue.identifier ? /^(.+)-\d+$/.exec(issue.identifier) : null;
  return m ? m[1] : issue.project_id;
}

/** ¿Es la página de un team (con o sin sub-ruta)? */
export function isTeamPath(pathname: string, team: { id: string; slug?: string | null }): boolean {
  const byKey = teamPath(team);
  const byId = teamPath(team.id);
  return [byKey, byId].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
