'use server';

import { getCurrentUser, type SessionUser } from '@/lib/session';
import { canSeeActivity, canSeeEntity, sessionScope } from '@/lib/crm-visibility';
import { updateActivity, updateContact, updateDeal } from '@/lib/crm';
import {
  associateContactCompany,
  associateDealCompany,
  removeContactCompany,
  removeDealCompany,
  setParentCompany,
} from '@/lib/crm-assoc';
import { CrmRefError } from '@/lib/crm-refs';

/**
 * Visibilidad por owner: no se asocia ni desasocia un registro (o tarea) que
 * la persona no ve. Lanza not_found igual que un id inexistente.
 */
async function guardVisible(
  user: SessionUser,
  refs: Array<['contact' | 'company' | 'deal' | 'task', string | null | undefined]>,
): Promise<void> {
  const scope = await sessionScope(user);
  if (!scope) return;
  for (const [entity, id] of refs) {
    if (!id) continue;
    const ok =
      entity === 'task' ? await canSeeActivity(user.id, id, scope) : await canSeeEntity(user.id, entity, id, scope);
    if (!ok) throw new Error('not_found');
  }
}

async function requireActor() {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  return user;
}

/** Empresa primaria del contacto (compat: companyId). null quita la primaria. */
export async function setContactCompany(contactId: string, companyId: string | null) {
  const user = await requireActor();
  await guardVisible(user, [['contact', contactId], ['company', companyId]]);
  const updated = await updateContact(
    user.id,
    contactId,
    { companyId },
    undefined,
    user.actingUser?.email ?? user.email,
  );
  if (!updated) throw new Error('not_found');
}

export async function addDealContact(dealId: string, contactId: string) {
  const user = await requireActor();
  await guardVisible(user, [['deal', dealId], ['contact', contactId]]);
  const updated = await updateDeal(
    user.id,
    dealId,
    { addContactIds: [contactId] },
    user.actingUser?.email ?? user.email,
  );
  if (!updated) throw new Error('not_found');
}

export async function removeDealContact(dealId: string, contactId: string) {
  const user = await requireActor();
  await guardVisible(user, [['deal', dealId], ['contact', contactId]]);
  const updated = await updateDeal(
    user.id,
    dealId,
    { removeContactIds: [contactId] },
    user.actingUser?.email ?? user.email,
  );
  if (!updated) throw new Error('not_found');
}

/** Asocia una empresa al deal (si no tenía, queda primaria). */
export async function addCompanyToDeal(dealId: string, companyId: string) {
  const user = await requireActor();
  await guardVisible(user, [['deal', dealId], ['company', companyId]]);
  await associateDealCompany(user.id, dealId, companyId, {});
}

export async function removeCompanyFromDeal(dealId: string, companyId: string) {
  const user = await requireActor();
  await guardVisible(user, [['deal', dealId], ['company', companyId]]);
  await removeDealCompany(user.id, dealId, companyId);
}

export async function setDealCompanyPrimary(dealId: string, companyId: string) {
  const user = await requireActor();
  await guardVisible(user, [['deal', dealId], ['company', companyId]]);
  await associateDealCompany(user.id, dealId, companyId, { primary: true });
}

export async function setTaskContact(taskId: string, contactId: string | null) {
  const user = await requireActor();
  await guardVisible(user, [['task', taskId], ['contact', contactId]]);
  const updated = await updateActivity(user.id, taskId, { contactId });
  if (!updated) throw new Error('not_found');
}

export async function setTaskCompany(taskId: string, companyId: string | null) {
  const user = await requireActor();
  await guardVisible(user, [['task', taskId], ['company', companyId]]);
  const updated = await updateActivity(user.id, taskId, { companyId });
  if (!updated) throw new Error('not_found');
}

export async function setTaskDeal(taskId: string, dealId: string | null) {
  const user = await requireActor();
  await guardVisible(user, [['task', taskId], ['deal', dealId]]);
  const updated = await updateActivity(user.id, taskId, { dealId });
  if (!updated) throw new Error('not_found');
}

// ---------- Wrappers para asociar desde el record padre (.bind-friendly) ----------
// Las pages server no pueden pasar funciones inline a Client Components; pasan
// server actions con .bind(null, recordId) para pre-llenar el id del padre.

/** Agrega una empresa al contacto (la primera queda primaria). */
export async function associateCompanyToContact(contactId: string, companyId: string) {
  const user = await requireActor();
  await guardVisible(user, [['contact', contactId], ['company', companyId]]);
  await associateContactCompany(user.id, contactId, companyId, {});
}

/** Quita una empresa del contacto (si era la primaria, se promueve la siguiente). */
export async function removeCompanyFromContact(contactId: string, companyId: string) {
  const user = await requireActor();
  await guardVisible(user, [['contact', contactId], ['company', companyId]]);
  await removeContactCompany(user.id, contactId, companyId);
}

export async function setContactCompanyPrimary(contactId: string, companyId: string) {
  const user = await requireActor();
  await guardVisible(user, [['contact', contactId], ['company', companyId]]);
  await associateContactCompany(user.id, contactId, companyId, { primary: true });
}

export async function setContactCompanyLabel(contactId: string, companyId: string, label: string) {
  const user = await requireActor();
  await guardVisible(user, [['contact', contactId], ['company', companyId]]);
  await associateContactCompany(user.id, contactId, companyId, { label });
}

export async function associateDealToContact(contactId: string, dealId: string) {
  return addDealContact(dealId, contactId);
}

export async function removeDealFromContact(contactId: string, dealId: string) {
  return removeDealContact(dealId, contactId);
}

export async function associateContactToCompany(companyId: string, contactId: string) {
  return associateCompanyToContact(contactId, companyId);
}

export async function removeContactFromCompany(companyId: string, contactId: string) {
  return removeCompanyFromContact(contactId, companyId);
}

export async function setCompanyContactLabel(companyId: string, contactId: string, label: string) {
  return setContactCompanyLabel(contactId, companyId, label);
}

/** Esta empresa pasa a ser la primaria del contacto. */
export async function setCompanyAsContactPrimary(companyId: string, contactId: string) {
  return setContactCompanyPrimary(contactId, companyId);
}

export async function associateDealToCompany(companyId: string, dealId: string) {
  return addCompanyToDeal(dealId, companyId);
}

export async function removeDealFromCompany(companyId: string, dealId: string) {
  return removeCompanyFromDeal(dealId, companyId);
}

export async function setCompanyAsDealPrimary(companyId: string, dealId: string) {
  return setDealCompanyPrimary(dealId, companyId);
}

export async function associateCompanyToDeal(dealId: string, companyId: string) {
  return addCompanyToDeal(dealId, companyId);
}

export async function removeCompanyFromDealByDeal(dealId: string, companyId: string) {
  return removeCompanyFromDeal(dealId, companyId);
}

export async function associateContactToDeal(dealId: string, contactId: string) {
  return addDealContact(dealId, contactId);
}

export async function removeContactFromDeal(dealId: string, contactId: string) {
  return removeDealContact(dealId, contactId);
}

// ---------- Jerarquía de empresas ----------

/** Ciclos o empresas ajenas vuelven como { error } para mostrarlos en el panel. */
async function hierarchy(companyId: string, parentId: string | null): Promise<{ error?: string }> {
  const user = await requireActor();
  await guardVisible(user, [['company', companyId], ['company', parentId]]);
  try {
    await setParentCompany(user.id, companyId, parentId);
    return {};
  } catch (e) {
    if (e instanceof CrmRefError) return { error: e.code };
    throw e;
  }
}

export async function setCompanyParent(companyId: string, parentId: string) {
  return hierarchy(companyId, parentId);
}

export async function clearCompanyParent(companyId: string) {
  const user = await requireActor();
  await guardVisible(user, [['company', companyId]]);
  await setParentCompany(user.id, companyId, null);
}

export async function addChildCompany(companyId: string, childId: string) {
  return hierarchy(childId, companyId);
}

export async function removeChildCompany(_companyId: string, childId: string) {
  const user = await requireActor();
  await guardVisible(user, [['company', _companyId], ['company', childId]]);
  await setParentCompany(user.id, childId, null);
}

// ---------- Tasks ----------

export async function associateContactToTask(taskId: string, contactId: string) {
  return setTaskContact(taskId, contactId);
}

export async function removeContactFromTask(taskId: string) {
  return setTaskContact(taskId, null);
}

export async function associateCompanyToTask(taskId: string, companyId: string) {
  return setTaskCompany(taskId, companyId);
}

export async function removeCompanyFromTask(taskId: string) {
  return setTaskCompany(taskId, null);
}

export async function associateDealToTask(taskId: string, dealId: string) {
  return setTaskDeal(taskId, dealId);
}

export async function removeDealFromTask(taskId: string) {
  return setTaskDeal(taskId, null);
}
