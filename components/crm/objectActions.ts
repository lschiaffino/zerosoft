'use server';

import { getCurrentUser } from '@/lib/session';
import { canSeeEntity, canSeeOwner, sessionScope } from '@/lib/crm-visibility';
import { getRecord, linkRecord, unlinkRecord, type ObjectLinkEntity } from '@/lib/crm-objects';
import { CrmRefError } from '@/lib/crm-refs';

/**
 * Asociaciones de registros de objetos propios con contactos, empresas y
 * deals (server actions de AssociationPanel). Las dos puntas tienen que
 * verse con la visibilidad por owner.
 */
async function guard(recordId: string, entity: ObjectLinkEntity, entityId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('unauthorized');
  const scope = await sessionScope(user);
  const record = await getRecord(user.id, recordId);
  if (!record || !canSeeOwner(scope, record.owner_id, user.id)) throw new Error('not_found');
  if (!(await canSeeEntity(user.id, entity, entityId, scope))) throw new Error('not_found');
  return user;
}

export async function linkObjectRecord(recordId: string, entity: ObjectLinkEntity, entityId: string) {
  const user = await guard(recordId, entity, entityId);
  try {
    await linkRecord(user.id, recordId, entity, entityId);
  } catch (e) {
    if (e instanceof CrmRefError) return { error: e.code };
    throw e;
  }
}

export async function unlinkObjectRecord(recordId: string, entity: ObjectLinkEntity, entityId: string) {
  const user = await guard(recordId, entity, entityId);
  await unlinkRecord(user.id, recordId, entity, entityId);
}

/** Desde un contacto/empresa/deal: asociar un registro (argumentos en el otro orden). */
export async function linkFromEntity(entity: ObjectLinkEntity, entityId: string, recordId: string) {
  return linkObjectRecord(recordId, entity, entityId);
}

export async function unlinkFromEntity(entity: ObjectLinkEntity, entityId: string, recordId: string) {
  return unlinkObjectRecord(recordId, entity, entityId);
}
