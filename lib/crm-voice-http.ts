/**
 * Acceso de sesión a una llamada del CRM: tiene que ser del workspace y la
 * persona tiene que ver sus registros (o haberla hecho/atendido). Server-only.
 */
import { getCurrentUser, realUserId } from './session';
import { canSeeActivityRefs, sessionScope } from './crm-visibility';
import { getCall } from './crm-voice';
import type { CrmCallRow } from './db';

type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export async function callForSession(
  id: string,
): Promise<{ user: SessionUser; call: CrmCallRow } | { error: 'unauthorized' | 'not_found' }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'unauthorized' };
  const call = await getCall(user.id, id);
  if (!call) return { error: 'not_found' };
  const personId = realUserId(user);
  if (call.person_id !== personId) {
    const refs = { contact_id: call.contact_id, company_id: call.company_id, deal_id: call.deal_id, owner_id: call.person_id };
    if (!(await canSeeActivityRefs(user.id, refs, await sessionScope(user)))) return { error: 'not_found' };
  }
  return { user, call };
}
