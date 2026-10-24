import { getTranslations } from 'next-intl/server';
import type { SessionUser } from '@/lib/session';
import { listLists } from '@/lib/crm';
import { listTags } from '@/lib/crm-tags';
import { sessionScope } from '@/lib/crm-visibility';
import { fieldAccessFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import { ownerOptions } from '@/lib/crm-owners';
import { listRuleFields, type RuleField } from './listRuleFields';

/**
 * Campos del filtro de listas dinámicas para la persona (server): sus owners,
 * tags y listas estáticas, y solo los campos propios que puede ver.
 */
export async function listFieldsFor(user: SessionUser, locale: string, exceptListId?: string): Promise<RuleField[]> {
  const scope = await sessionScope(user);
  const [t, owners, tags, lists, access] = await Promise.all([
    getTranslations({ locale, namespace: 'crm' }),
    ownerOptions(user),
    listTags(user.id, undefined, scope),
    listLists(user.id, scope),
    fieldAccessFor(sessionFieldViewer(user), 'contacts'),
  ]);
  return listRuleFields({
    t: (k) => t(k),
    owners,
    tags: tags.map((x) => ({ value: x.id, label: x.name })),
    staticLists: lists.filter((l) => l.kind === 'static' && l.id !== exceptListId).map((l) => ({ value: l.id, label: l.name })),
    customDefs: access.visible,
  });
}
