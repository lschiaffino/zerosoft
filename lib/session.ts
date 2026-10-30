import { cache } from 'react';
import { getServerSession } from 'next-auth';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_PATH_HEADER, RETURN_PATH_HEADER, signInPath } from './return-path';
import { authOptions } from './auth';
import { getUserByEmail, upsertUser, type TeamRow, type UserRow } from './db';
import { resolveWorkspace, roleAtLeast, type TeamRole } from './teams';
import { appFromPath, ensureWorkspace, hasAllApps, userCanUseApp, workspaceTeamId, type AppAccess } from './workspace';
import type { ProductKey } from './products';
import { seedUserIfNeeded } from './seed';

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
   * La página pedida es de una app que la persona no tiene en el workspace
   * activo: la sesión cae a su workspace propio (ninguna página carga datos
   * del ajeno) y el layout de la app redirige con un aviso.
   */
  blockedApp?: ProductKey;
}


/** Puede gestionar miembros y borrar configuración del workspace. */
export function isWorkspaceAdmin(user: SessionUser): boolean {
  return roleAtLeast(user.role, 'admin');
}

/** Id real de la persona logueada (no el del owner del workspace). */
export function realUserId(user: SessionUser): string {
  return user.actingUser?.id ?? user.id;
}

export { hasAllApps, userCanUseApp, workspaceTeamId };

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
  let real: UserRow | null;
  const e2e = DEMO_MODE ? await e2eIdentity() : null;
  if (DEMO_MODE && e2e !== 'session') {
    real = e2e ?? (await getDemoUser());
  } else {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return null;
    real = (await getUserByEmail(email)) ?? null;
  }
  if (!real) return null;
  const { owner, team, workspace, role, apps } = await resolveWorkspace(real);
  const user: SessionUser =
    owner.id === real.id ? { ...real, team, workspace, role, apps } : { ...owner, actingUser: real, team, workspace, role, apps };
  // Acceso por app: la API de una app que la persona no tiene en este
  // workspace responde como sin sesión. Las páginas las corta el layout.
  if (user.actingUser) {
    const app = appFromPath(await requestHeader(API_PATH_HEADER));
    if (app && !userCanUseApp(user, app)) return null;
    const page = appFromPath(await requestHeader(RETURN_PATH_HEADER));
    if (page && !userCanUseApp(user, page)) {
      // Las páginas (y su payload RSC) se arman con el workspace propio: nada del ajeno viaja.
      return { ...real, team: null, workspace: await ensureWorkspace(real.id), role: 'owner', apps: '*', blockedApp: page };
    }
  }
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
  if (!user) redirect(signInPath(locale, returnTo ?? (await requestHeader(RETURN_PATH_HEADER))));
  return user;
}
