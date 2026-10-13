import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from './auth';
import { getUserByEmail, upsertUser, type TeamRow, type UserRow } from './db';
import { resolveWorkspace, roleAtLeast, type TeamRole } from './teams';
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
 * Usuario efectivo de la request: el dueño del workspace activo.
 * Si estás actuando en un team ajeno, `id` es el del owner (los datos del CRM
 * viven bajo su id), `actingUser` es tu identidad real y `team` el team activo.
 */
export interface SessionUser extends UserRow {
  actingUser?: UserRow;
  team?: TeamRow | null;
  /** Rol en el workspace activo ('owner' en el workspace personal). */
  role: TeamRole;
}

/** Puede gestionar miembros y borrar configuración del workspace. */
export function isWorkspaceAdmin(user: SessionUser): boolean {
  return roleAtLeast(user.role, 'admin');
}

/** Id real de la persona logueada (no el del owner del workspace). */
export function realUserId(user: SessionUser): string {
  return user.actingUser?.id ?? user.id;
}

async function getDemoUser(): Promise<UserRow> {
  const demo =
    (await getUserByEmail(DEMO_EMAIL)) ??
    (await upsertUser({ id: 'demo', email: DEMO_EMAIL, name: 'Demo User', image: null }));
  await seedUserIfNeeded(demo.id);
  return demo;
}

/**
 * Usuario actual (sesión Google o, si DEMO_MODE=true, el usuario demo),
 * resuelto a su workspace activo. Devuelve null si no hay sesión.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  if (DEMO_MODE) {
    const demo = await getDemoUser();
    const { owner, team, role } = await resolveWorkspace(demo);
    if (owner.id === demo.id) return { ...demo, team, role };
    return { ...owner, actingUser: demo, team, role };
  }
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const user = (await getUserByEmail(email)) ?? null;
  if (!user) return null;
  const { owner, team, role } = await resolveWorkspace(user);
  if (owner.id === user.id) return { ...user, team, role };
  return { ...owner, actingUser: user, team, role };
}

/**
 * Igual que getCurrentUser pero redirige a /auth/signin si no hay sesión.
 * Pensado para proteger las páginas del dashboard.
 */
export async function requireUser(locale: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/auth/signin`);
  return user;
}
