/**
 * CRM: lifecycle que avanza solo con los deals, como los defaults de HubSpot.
 * Server-only.
 *
 * - Se crea un deal: sus contactos y empresas pasan a Opportunity.
 * - Un deal pasa a una etapa ganada: pasan a Customer.
 *
 * Solo hacia adelante en el orden del workspace (Ajustes › Datos ›
 * Opciones): un registro que ya está en esa etapa o más adelante no cambia, y
 * si el destino está archivado no se mueve nada. Un admin lo apaga en
 * Ajustes › Datos (crm_settings.lifecycle_auto).
 *
 * Es una regla del workspace (como un workflow), no de una persona: el cambio
 * se guarda con el autor `system:<motivo>` y sale en el historial y el
 * timeline de cada registro, que solo ve quien ve ese registro. El motivo no
 * nombra el deal.
 */
import { getDb, type Db } from './db';
import { getCrmSettings } from './crm-currency';
import { listOptionSets, optionRank, type PropertyOption } from './crm-property-options';

export type LifecycleAutoReason = 'deal_created' | 'deal_won';

/** Autor de un cambio automático (crm_property_events.actor_email). */
export const SYSTEM_ACTOR_PREFIX = 'system:';
export function systemActor(reason: LifecycleAutoReason): string {
  return `${SYSTEM_ACTOR_PREFIX}${reason}`;
}
export function isSystemActor(actor: string | null | undefined): boolean {
  return !!actor && actor.startsWith(SYSTEM_ACTOR_PREFIX);
}

const TARGET: Record<LifecycleAutoReason, string> = { deal_created: 'opportunity', deal_won: 'customer' };

/**
 * ¿Pasa de `current` a `target`? Solo si el destino es una opción activa y
 * está más adelante (un valor que ya no es opción cuenta como el principio).
 */
export function shouldAdvance(options: PropertyOption[], current: string, target: string): boolean {
  const t = optionRank(options, target);
  if (t < 0 || options[t].archived) return false;
  if (current === target) return false;
  return optionRank(options, current) < t;
}

/**
 * Avanza los contactos y empresas asociados al deal. Devuelve cuántos
 * cambió. Nunca tira: un error no corta la operación del deal.
 */
export async function advanceLifecycleForDeal(ws: string, dealId: string, reason: LifecycleAutoReason, db: Db = getDb()): Promise<number> {
  try {
    if (!(await getCrmSettings(ws, db)).lifecycleAuto) return 0;
    const deal = await db.prepare('SELECT id FROM crm_deals WHERE id = ? AND user_id = ?').get(dealId, ws);
    if (!deal) return 0;
    const options = (await listOptionSets(ws, db)).lifecycle;
    const target = TARGET[reason];
    if (!shouldAdvance(options, '', target)) return 0;
    const contacts = (await db
      .prepare(
        `SELECT c.id, c.lifecycle_stage FROM crm_deal_contacts dc
         JOIN crm_contacts c ON c.id = dc.contact_id AND c.user_id = ?
         WHERE dc.deal_id = ?`,
      )
      .all(ws, dealId)) as Array<{ id: string; lifecycle_stage: string }>;
    const companies = (await db
      .prepare(
        `SELECT co.id, co.lifecycle_stage FROM crm_deal_companies dco
         JOIN crm_companies co ON co.id = dco.company_id AND co.user_id = ?
         WHERE dco.deal_id = ? AND dco.user_id = ?`,
      )
      .all(ws, dealId, ws)) as Array<{ id: string; lifecycle_stage: string }>;
    const { updateCompany, updateContact } = await import('./crm');
    const actor = systemActor(reason);
    let changed = 0;
    for (const c of contacts) {
      if (!shouldAdvance(options, c.lifecycle_stage, target)) continue;
      if (await updateContact(ws, c.id, { lifecycleStage: target }, db, actor)) changed += 1;
    }
    for (const co of companies) {
      if (!shouldAdvance(options, co.lifecycle_stage, target)) continue;
      if (await updateCompany(ws, co.id, { lifecycleStage: target }, db, actor)) changed += 1;
    }
    return changed;
  } catch {
    return 0;
  }
}
