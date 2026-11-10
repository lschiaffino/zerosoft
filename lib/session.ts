import { cache } from 'react';
import { getServerSession } from 'next-auth';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_PATH_HEADER, RETURN_PATH_HEADER, signInPath, WORKSPACE_HEADER } from './return-path';
import { authOptions } from './auth';
import { getUserByEmail, upsertUser, type TeamRow, type UserRow } from './db';
import { resolveWorkspace, type TeamRole } from './teams';
import { appFromPath, ensureWorkspace, getWorkspace, hasAllApps, userCanUseApp, workspaceTeamId, type AppAccess } from './workspace';
import type { ProductKey } from './products';
import { seedUserIfNeeded } from './seed';
import { delegatedIdentity } from './mcp/identity';
import { can } from './permissions';
import { touchActivity } from './workspace-admin';
import { blockedAppsFor } from './workspace-apps';
import { isComingSoon } from './products';
import { getSessionRow, mfaEnabled, sessionState, touchSession, type SessionState } from './account-security';

/**
 * DEMO_MODE convierte a todo visitante en el usuario demo compartido. En
 * producción queda apagado salvo que se lo pida explícitamente con
 * DEMO_MODE_ALLOW_PRODUCTION=true (p. ej. un deploy público de demo).
 */
export const DEMO_MODE =
  process.env.DEMO_MODE === 'true' &&
  (process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE_ALLOW_PRODUCTION === 'true');
export const DEMO_EMAIL = 'demo@zerosoft.ai';

/**
 * Solo e2e (playwright.config.ts): con DEMO_MODE y E2E_IDENTITY_COOKIE=1, la
 * cookie zs_e2e_as=<email> hace que el pedido sea de esa persona (otra sesión
 * para probar invitaciones; zs_e2e_as=session usa la sesión real de NextAuth,
 * o ninguna). Nunca se prende en un deploy: la variable no existe fuera de los tests.
 */
export const E2E_IDENTITY_COOKIE = 'zs_e2e_as';
// Falla cerrado: además de la variable, solo en CI o tests y nunca en Vercel.
const E2E_IDENTITY =
  DEMO_MODE &&
  process.env.E2E_IDENTITY_COOKIE === '1' &&
  (Boolean(process.env.CI) || process.env.NODE_ENV === 'test') &&
  !process.env.VERCEL_ENV &&
  !process.env.VERCEL;

/**
 * Usuario efectivo de la request: el dueño del workspace activo.
 * Si estás actuando en un workspace ajeno, `id` es el del owner (los datos de
 * todas las apps viven bajo su id) y `actingUser` es tu identidad real.
 * "Estoy en uno ajeno" es `actingUser`; `workspace` es la ficha del workspace
 * activo (también la propia) y `team` el equipo que Track y Chat usan de
 * clave (solo equipos de antes de 128; null en los workspaces nuevos).
 */
export interface SessionUser extends UserRow {
  actingUser?: UserRow;
  team?: TeamRow | null;
  /** Ficha del workspace activo (nombre, logo, modo, miembros). */
  workspace?: TeamRow;
  /** Rol en el workspace activo ('owner' en el propio). */
  role: TeamRole;
  /** Apps a las que accede en el workspace activo ('*' = todas). */
  apps?: AppAccess;
  /**
   * Apps que no abre por la plataforma (Próximamente) o por Apps del workspace,
   * ya resueltas para la persona (lib/app-access.ts). Las cuenta userCanUseApp.
   */
  blockedApps?: ProductKey[];
  /**
   * La página pedida es de una app que la persona no tiene en el workspace
   * activo: la sesión cae a su workspace propio (ninguna página carga datos
   * del ajeno) y el layout de la app redirige con un aviso.
   */
  blockedApp?: ProductKey;
  /**
   * El workspace activo exige la verificación en dos pasos y la persona no la tiene: la sesión
   * cae a su workspace propio y el layout la manda a Ajustes › Seguridad a activarla.
   */
  mfaRequiredBy?: string;
  /** Id de la sesión del servidor (user_sessions) de esta request; null en sesiones de antes o demo. */
  sid?: string | null;
}


/** Puede gestionar miembros y borrar configuración del workspace. */
export function isWorkspaceAdmin(user: SessionUser): boolean {
  return can(user, 'workspace.edit');
}

/** Id real de la persona logueada (no el del owner del workspace). */
export function realUserId(user: SessionUser): string {
  return user.actingUser?.id ?? user.id;
}

export { hasAllApps, userCanUseApp, workspaceTeamId };

/** Adonde va la API de una app cortada: /api/apps/blocked responde 403 con el motivo. */
function appGatePath(app: ProductKey): string {
  return `/api/apps/blocked?app=${app}&reason=${isComingSoon(app) ? 'coming_soon' : 'workspace'}`;
}

// Usuario demo ya sembrado en este proceso: evita el UPDATE de reclamo de
// seedUserIfNeeded en cada request (después de la primera siempre es no-op).
let demoSeededId: string | null = null;

async function getDemoUser(): Promise<UserRow> {
  const demo =
    (await getUserByEmail(DEMO_EMAIL)) ??
    (await upsertUser({ id: 'demo', email: DEMO_EMAIL, name: 'Demo User', image: null }));
  if (demoSeededId !== demo.id) {
    await seedUserIfNeeded(demo.id);
    demoSeededId = demo.id;
  }
  return demo;
}

async function e2eIdentity(): Promise<UserRow | 'session' | null> {
  if (!E2E_IDENTITY) return null;
  try {
    const email = (await cookies()).get(E2E_IDENTITY_COOKIE)?.value?.trim().toLowerCase();
    // zs_e2e_as=session: la sesión real de NextAuth (o ninguna), para probar el login por código.
    if (email === 'session') return 'session';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === DEMO_EMAIL) return null;
    return (await getUserByEmail(email)) ?? (await upsertUser({ email, name: email.split('@')[0], image: null }));
  } catch {
    return null;
  }
}

/**
 * Usuario actual (sesión Google o, si DEMO_MODE=true, el usuario demo),
 * resuelto a su workspace activo. Devuelve null si no hay sesión.
 *
 * Va envuelto en cache(): en un render el Header, el layout de la app y la
 * página lo piden por separado y comparten una sola resolución. Fuera de un
 * render de React (route handlers, tests) no cachea: cada request vuelve a
 * mirar la membresía, así que sacar a alguien le corta el acceso al instante.
 */
export const getCurrentUser = cache(loadCurrentUser);

async function loadCurrentUser(): Promise<SessionUser | null> {
  // Una operación del MCP: la persona del token, con los mismos chequeos que su sesión.
  const delegated = delegatedIdentity();
  if (delegated) return delegatedUser(delegated);
  let real: UserRow | null;
  let sid: string | null = null;
  // Ficha del workspace propio, pedida junto con el usuario (no después): en Turso cada query es
  // una ida y vuelta, y esta resolución corre en cada página y cada API.
  let ownWorkspace: Promise<TeamRow | null> | null = null;
  const e2e = DEMO_MODE ? await e2eIdentity() : null;
  if (DEMO_MODE && e2e !== 'session') {
    if (!e2e && demoSeededId) ownWorkspace = getWorkspace(demoSeededId);
    ownWorkspace?.catch(() => {});
    real = e2e ?? (await getDemoUser());
  } else {
    const gate = await sessionGate();
    if (gate.state !== 'ok' || !gate.user) return null;
    real = gate.user;
    sid = gate.sid;
    ownWorkspace = gate.ownWorkspace;
  }
  if (!real) return null;
  const { owner, team, workspace, role, apps } = await resolveWorkspace(real, ownWorkspace);
  const expected = await requestHeader(WORKSPACE_HEADER);
  // El workspace ajeno exige dos pasos y esta persona no los tiene: no entra a sus datos.
  if (owner.id !== real.id && workspace?.require_mfa && !mfaEnabled(real)) {
    const own = await ensureWorkspace(real.id);
    // La pestaña ya está en su workspace propio (la cayó acá el layout): sus pedidos valen.
    if (expected && expected !== own.id) return null;
    return { ...real, sid, team: null, workspace: own, role: 'owner', apps: '*', mfaRequiredBy: workspace.name };
  }
  const user: SessionUser =
    owner.id === real.id ? { ...real, sid, team, workspace, role, apps } : { ...owner, sid, actingUser: real, team, workspace, role, apps };
  // La pestaña escribe pensando en otro workspace (la sacaron, o cambió en otra pestaña): nada se
  // guarda en el lugar equivocado. Responde como sin sesión y la pestaña avisa y ofrece recargar.
  if (expected && workspace && expected !== workspace.id) return null;
  // Acceso por app (lib/app-access.ts): Próximamente, Apps del workspace y las
  // apps habilitadas de la persona. Una app cortada por la plataforma o el
  // workspace responde 403 en su API; una que la persona no tiene, como sin sesión.
  // Las páginas las corta el layout.
  user.blockedApps = await blockedAppsFor({ ownerId: owner.id, personId: real.id, role, email: real.email });
  const app = appFromPath(await requestHeader(API_PATH_HEADER));
  if (app && !userCanUseApp(user, app)) {
    if (user.blockedApps.includes(app)) redirect(appGatePath(app));
    return null;
  }
  const page = appFromPath(await requestHeader(RETURN_PATH_HEADER));
  if (page && !userCanUseApp(user, page)) {
    // Las páginas (y su payload RSC) se arman con el workspace propio: nada del ajeno viaja.
    if (user.actingUser) {
      return { ...real, team: null, workspace: await ensureWorkspace(real.id), role: 'owner', apps: '*', blockedApps: user.blockedApps, blockedApp: page };
    }
    return { ...user, blockedApp: page };
  }
  // "Última actividad" de Miembros y permisos (a lo sumo una escritura cada 10 minutos, sin esperar).
  touchActivity(workspace?.id, real.id);
  return user;
}

interface SessionGate {
  state: SessionState | 'none';
  user: UserRow | null;
  sid: string | null;
  /** Ficha del workspace propio, pedida en paralelo (no se espera acá). */
  ownWorkspace: Promise<TeamRow | null> | null;
}

/**
 * La sesión de NextAuth contra la del servidor (lib/account-security.ts): 'none' sin cookie,
 * 'invalid' si se cerró o venció, 'mfa_pending' si falta el segundo paso. La persona y la fila
 * de la sesión se piden juntas (en Turso cada query es una ida y vuelta).
 */
export const sessionGate = cache(async (): Promise<SessionGate> => {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return { state: 'none', user: null, sid: null, ownWorkspace: null };
  const rawSid = (session as { sid?: unknown }).sid;
  const sid = typeof rawSid === 'string' && rawSid ? rawSid : null;
  const uid = (session.user as { id?: unknown }).id;
  const ownWorkspace = typeof uid === 'string' && uid ? getWorkspace(uid) : null;
  ownWorkspace?.catch(() => {});
  const [user, row] = await Promise.all([getUserByEmail(email), sid ? getSessionRow(sid) : Promise.resolve(null)]);
  if (!user) return { state: 'none', user: null, sid, ownWorkspace: null };
  const state = sessionState(user, sid, row);
  if (state === 'ok' && row) touchSession(row);
  return { state, user, sid, ownWorkspace: state === 'ok' ? ownWorkspace : null };
});

async function delegatedUser(d: NonNullable<ReturnType<typeof delegatedIdentity>>): Promise<SessionUser | null> {
  const { owner, team, workspace, role, apps } = await resolveWorkspace(d.real);
  // Fijado a un workspace del que ya no es parte: sin acceso, nunca cae al propio.
  if (d.pinnedTeamId && workspace.id !== d.pinnedTeamId) return null;
  // Un workspace que exige dos pasos tampoco se abre por el MCP sin ellos.
  if (owner.id !== d.real.id && workspace.require_mfa && !mfaEnabled(d.real)) return null;
  const user: SessionUser =
    owner.id === d.real.id ? { ...d.real, team, workspace, role, apps } : { ...owner, actingUser: d.real, team, workspace, role, apps };
  user.blockedApps = await blockedAppsFor({ ownerId: owner.id, personId: d.real.id, role, email: d.real.email });
  const app = appFromPath(d.apiPath);
  if (app && !userCanUseApp(user, app)) return null;
  return user;
}

async function requestHeader(name: string): Promise<string | null> {
  try {
    return (await headers()).get(name);
  } catch {
    return null; // fuera de una request (tests, scripts)
  }
}

/**
 * Igual que getCurrentUser pero redirige a /auth/signin si no hay sesión.
 * Pensado para proteger las páginas del dashboard.
 *
 * `returnTo` (path + query de la página) viaja como ?callbackUrl= para volver
 * ahí después del login: un clip o un link ?note=<id> no se pierden. Sin él se
 * usa el path que deja el middleware en un header interno (layouts).
 */
export async function requireUser(locale: string, returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const back = returnTo ?? (await requestHeader(RETURN_PATH_HEADER));
    // Entró con Google o el código, falta el segundo paso.
    if (!DEMO_MODE && (await sessionGate()).state === 'mfa_pending') {
      redirect(`/${locale}/auth/mfa${back ? `?callbackUrl=${encodeURIComponent(back)}` : ''}`);
    }
    redirect(signInPath(locale, back));
  }
  // Página de una app cortada (Próximamente, Apps del workspace o la persona no la tiene). Se corta acá
  // y no solo en el layout de /app: en una navegación del cliente ese layout no se vuelve a armar.
  if (user.blockedApp) {
    redirect(isComingSoon(user.blockedApp) ? `/${locale}/app/soon/${user.blockedApp}` : `/${locale}/app?blocked=${user.blockedApp}`);
  }
  return user;
}
