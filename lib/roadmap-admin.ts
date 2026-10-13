import { getCurrentUser } from './session';
import { isAdminEmail } from './feedback';

/** True si la persona logueada está en ADMIN_EMAILS (misma regla que /app/settings/feedback). */
export async function currentUserIsAdmin(): Promise<boolean> {
  const user = await getCurrentUser().catch(() => null);
  return isAdminEmail(user?.actingUser?.email ?? user?.email);
}
