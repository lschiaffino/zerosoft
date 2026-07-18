import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from './auth';
import { getUserByEmail, upsertUser, type UserRow } from './db';

export const DEMO_MODE = process.env.DEMO_MODE === 'true';
export const DEMO_EMAIL = 'demo@zerosoft.ai';

function getDemoUser(): UserRow {
  return (
    getUserByEmail(DEMO_EMAIL) ??
    upsertUser({ id: 'demo', email: DEMO_EMAIL, name: 'Demo User', image: null })
  );
}

/**
 * Usuario actual (sesión Google o, si DEMO_MODE=true, el usuario demo).
 * Devuelve null si no hay sesión.
 */
export async function getCurrentUser(): Promise<UserRow | null> {
  if (DEMO_MODE) return getDemoUser();
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  return getUserByEmail(email) ?? null;
}

/**
 * Igual que getCurrentUser pero redirige a /auth/signin si no hay sesión.
 * Pensado para proteger las páginas del dashboard.
 */
export async function requireUser(locale: string): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/auth/signin`);
  return user;
}
