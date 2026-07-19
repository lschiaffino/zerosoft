'use server';

import { getCurrentUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { updateActivity, updateContact, updateDeal } from '@/lib/crm';

export async function setContactCompany(contactId: string, companyId: string | null) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
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
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const updated = await updateDeal(
    user.id,
    dealId,
    { addContactIds: [contactId] },
    user.actingUser?.email ?? user.email,
  );
  if (!updated) throw new Error('not_found');
}

export async function removeDealContact(dealId: string, contactId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const updated = await updateDeal(
    user.id,
    dealId,
    { removeContactIds: [contactId] },
    user.actingUser?.email ?? user.email,
  );
  if (!updated) throw new Error('not_found');
}

export async function addCompanyToDeal(dealId: string, companyId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const contact = (await getDb()
    .prepare(
      'SELECT id FROM crm_contacts WHERE company_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1',
    )
    .get(companyId, user.id)) as { id: string } | undefined;
  if (!contact) throw new Error('no_contact');
  const updated = await updateDeal(
    user.id,
    dealId,
    { addContactIds: [contact.id] },
    user.actingUser?.email ?? user.email,
  );
  if (!updated) throw new Error('not_found');
}

export async function removeCompanyFromDeal(dealId: string, companyId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const companyContacts = (await getDb()
    .prepare('SELECT id FROM crm_contacts WHERE company_id = ? AND user_id = ?')
    .all(companyId, user.id)) as Array<{ id: string }>;
  const associated = (await getDb()
    .prepare('SELECT contact_id FROM crm_deal_contacts WHERE deal_id = ?')
    .all(dealId)) as Array<{ contact_id: string }>;
  const associatedIds = new Set(associated.map((r) => r.contact_id));
  const removeIds = companyContacts.map((c) => c.id).filter((id) => associatedIds.has(id));
  if (!removeIds.length) return;
  const updated = await updateDeal(
    user.id,
    dealId,
    { removeContactIds: removeIds },
    user.actingUser?.email ?? user.email,
  );
  if (!updated) throw new Error('not_found');
}

export async function setTaskContact(taskId: string, contactId: string | null) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const updated = await updateActivity(user.id, taskId, { contactId });
  if (!updated) throw new Error('not_found');
}

export async function setTaskCompany(taskId: string, companyId: string | null) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const updated = await updateActivity(user.id, taskId, { companyId });
  if (!updated) throw new Error('not_found');
}

export async function setTaskDeal(taskId: string, dealId: string | null) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const updated = await updateActivity(user.id, taskId, { dealId });
  if (!updated) throw new Error('not_found');
}

// ---------- Wrappers para asociar desde el record padre (.bind-friendly) ----------
// Las pages server no pueden pasar funciones inline a Client Components; pasan
// server actions con .bind(null, recordId) para pre-llenar el id del padre.

export async function associateCompanyToContact(contactId: string, companyId: string) {
  return setContactCompany(contactId, companyId);
}

export async function removeCompanyFromContact(contactId: string) {
  return setContactCompany(contactId, null);
}

export async function associateDealToContact(contactId: string, dealId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const updated = await updateDeal(
    user.id,
    dealId,
    { addContactIds: [contactId] },
    user.actingUser?.email ?? user.email,
  );
  if (!updated) throw new Error('not_found');
}

export async function removeDealFromContact(contactId: string, dealId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const updated = await updateDeal(
    user.id,
    dealId,
    { removeContactIds: [contactId] },
    user.actingUser?.email ?? user.email,
  );
  if (!updated) throw new Error('not_found');
}

export async function associateContactToCompany(companyId: string, contactId: string) {
  return setContactCompany(contactId, companyId);
}

export async function removeContactFromCompany(companyId: string, contactId: string) {
  return setContactCompany(contactId, null);
}

export async function associateDealToCompany(companyId: string, dealId: string) {
  return addCompanyToDeal(dealId, companyId);
}

export async function removeDealFromCompany(companyId: string, dealId: string) {
  return removeCompanyFromDeal(dealId, companyId);
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
