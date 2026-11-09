/**
 * Quién abre cada app, en una sola regla (sin base: la usan el servidor, el
 * MCP, las API keys y la pantalla de Ajustes). Tres capas, en orden:
 *
 * 1. Plataforma: una app "Próximamente" (lib/products.ts) no la abre nadie
 *    salvo el staff de zerosoft (ADMIN_EMAILS), para probarla por dentro.
 * 2. Workspace (Ajustes › Apps del workspace): cada app de equipo está para
 *    todos, para algunos (personas y equipos), solo para admins o apagada.
 *    Apagada no la abre nadie, ni el owner; los datos quedan.
 * 3. Persona (Ajustes › Miembros y permisos): las apps habilitadas de cada
 *    miembro (team_members.apps). El owner las tiene todas.
 *
 * Las apps personales (Inbox, Notes, Docs…) no pasan por la capa 2.
 */
import { isAlwaysOnApp, isComingSoon, isProductKey, isWorkspaceGatedApp, PRODUCT_KEYS, type ProductKey } from './products';

export type WorkspaceAppMode = 'all' | 'some' | 'admins' | 'off';
export const WORKSPACE_APP_MODES: readonly WorkspaceAppMode[] = ['all', 'some', 'admins', 'off'];

export interface WorkspaceAppRule {
  mode: WorkspaceAppMode;
  /** Con 'some': personas (user id) que la abren. */
  people: string[];
  /** Con 'some': equipos del workspace (workspace_groups.id) cuyos miembros la abren. */
  teams: string[];
}

export type WorkspaceAppRules = Partial<Record<ProductKey, WorkspaceAppRule>>;

/** Por qué una persona no abre una app. */
export type AppDenial = 'coming_soon' | 'workspace_off' | 'workspace_restricted' | 'member';

export interface AppAccessSubject {
  role: string | null | undefined;
  /** Apps habilitadas de la persona ('*' o lista). */
  apps?: '*' | readonly string[] | null;
  personId: string;
  /** Equipos del workspace de los que es parte (para 'some'). */
  teamIds?: readonly string[];
  /** Staff de zerosoft: abre las apps "Próximamente". */
  staff?: boolean;
}

export function isWorkspaceAppMode(v: unknown): v is WorkspaceAppMode {
  return typeof v === 'string' && (WORKSPACE_APP_MODES as readonly string[]).includes(v);
}

const isAdminRole = (role: string | null | undefined) => role === 'owner' || role === 'admin';

/**
 * ¿Por qué no la abre? null = la abre. La capa de la persona (apps
 * habilitadas) solo se mira si viene `apps`: así sirve también para saber qué
 * corta el workspace sin mirar los toggles.
 */
export function appDenial(subject: AppAccessSubject, app: ProductKey, rules: WorkspaceAppRules = {}): AppDenial | null {
  if (isComingSoon(app) && !subject.staff) return 'coming_soon';
  if (isWorkspaceGatedApp(app)) {
    const rule = rules[app];
    if (rule?.mode === 'off') return 'workspace_off';
    if (rule?.mode === 'admins' && !isAdminRole(subject.role)) return 'workspace_restricted';
    if (rule?.mode === 'some' && !isAdminRole(subject.role)) {
      const inPeople = rule.people.includes(subject.personId);
      const inTeams = (subject.teamIds ?? []).some((t) => rule.teams.includes(t));
      if (!inPeople && !inTeams) return 'workspace_restricted';
    }
  }
  if (subject.apps !== undefined && memberDenied(subject.role, subject.apps, app)) return 'member';
  return null;
}

/**
 * Capa 3 sola (los toggles de Miembros y permisos): owner todas; guest
 * ninguna; admin y member, las suyas. Inbox (personal) siempre.
 */
export function memberDenied(role: string | null | undefined, apps: '*' | readonly string[] | null | undefined, app: ProductKey): boolean {
  if (role === 'owner' || isAlwaysOnApp(app)) return false;
  if (role === 'guest' || role == null) return true;
  return apps != null && apps !== '*' && !apps.includes(app);
}

/** Apps que cortan la plataforma o el workspace (no los toggles de la persona). */
export function blockedApps(subject: Omit<AppAccessSubject, 'apps'>, rules: WorkspaceAppRules = {}): ProductKey[] {
  return PRODUCT_KEYS.filter((app) => appDenial({ ...subject, apps: undefined }, app, rules) !== null);
}

/** Apps apagadas para todo el workspace (no se muestran en ningún lado). */
export function workspaceOffApps(rules: WorkspaceAppRules): ProductKey[] {
  return PRODUCT_KEYS.filter((app) => isWorkspaceGatedApp(app) && rules[app]?.mode === 'off');
}

/** Normaliza lo que llega del cliente o de la base. null si no es una regla válida. */
export function parseRule(raw: unknown): WorkspaceAppRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { mode?: unknown; people?: unknown; teams?: unknown };
  if (!isWorkspaceAppMode(r.mode)) return null;
  const ids = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128))].slice(0, 500) : [];
  return { mode: r.mode, people: r.mode === 'some' ? ids(r.people) : [], teams: r.mode === 'some' ? ids(r.teams) : [] };
}

export function isRuleKey(app: string): app is ProductKey {
  return isProductKey(app) && isWorkspaceGatedApp(app) && !isComingSoon(app);
}
