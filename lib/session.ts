import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from './auth';
import { getUserByEmail, upsertUser, type TeamRow, type UserRow } from './db';
import { resolveWorkspace } from './teams';
import { seedUserIfNeeded } from './seed';

export const DEMO_MODE = process.env.DEMO_MODE === 'true';
export const DEMO_EMAIL = 'demo@zerosoft.ai';

/**
 * Usuario efectivo de la request: el dueño del workspace activo.
 * Si estás actuando en un team ajeno, `id` es el del owner (los datos del CRM
 * viven bajo su id), `actingUser` es tu identidad real y `team` el team activo.
 */
export interface SessionUser extends UserRow {
  actingUser?: UserRow;
  team?: TeamRow | null;
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
    const { owner, team } = await resolveWorkspace(demo);
    if (owner.id === demo.id) return { ...demo, team };
    return { ...owner, actingUser: demo, team };
  }
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const user = (await getUserByEmail(email)) ?? null;
  if (!user) return null;
  const { owner, team } = await resolveWorkspace(user);
  if (owner.id === user.id) return { ...user, team };
  return { ...owner, actingUser: user, team };
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
