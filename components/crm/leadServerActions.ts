'use server';

import { getCurrentUser } from '@/lib/session';
import { canSeeEntity, canSeeOwner, sessionScope } from '@/lib/crm-visibility';
import { getLead, updateLead } from '@/lib/crm-leads';
import { CrmRefError } from '@/lib/crm-refs';

/**
 * Contacto y empresa del lead desde la pestaña Relacionados (server actions
 * de AssociationPanel). El lead y el registro tienen que verse.
 */
async function setRef(leadId: string, kind: 'contact' | 'company', id: string | null) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const scope = await sessionScope(user);
  const lead = await getLead(user.id, leadId);
  if (!lead || !canSeeOwner(scope, lead.owner_id, user.id)) throw new Error('not_found');
  if (id && !(await canSeeEntity(user.id, kind, id, scope))) throw new Error('not_found');
  try {
    await updateLead(user.id, leadId, kind === 'contact' ? { contactId: id } : { companyId: id });
  } catch (e) {
    if (e instanceof CrmRefError) return { error: e.code };
    throw e;
  }
}

export async function setLeadContact(leadId: string, contactId: string) {
  return setRef(leadId, 'contact', contactId);
}

export async function clearLeadContact(leadId: string) {
  return setRef(leadId, 'contact', null);
}

export async function setLeadCompany(leadId: string, companyId: string) {
  return setRef(leadId, 'company', companyId);
}

export async function clearLeadCompany(leadId: string) {
  return setRef(leadId, 'company', null);
}
