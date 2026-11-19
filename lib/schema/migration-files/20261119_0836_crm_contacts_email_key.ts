import type { Migration } from '../migrations';

/**
 * CRM: índice por la clave del email del contacto (minúsculas, sin espacios
 * alrededor), la misma expresión con la que lib/crm-contact-email.ts busca
 * antes de crear o editar un contacto.
 *
 * NO es único a propósito: producción puede tener contactos con el mismo
 * email de antes de la regla, y un índice único fallaría al crearse. La
 * unicidad la hace cumplir el camino de escritura (createContact y
 * updateContact). Cuando Contactos › Duplicados quede vacío en todos los
 * workspaces, otra migración puede sumar el único parcial.
 *
 * No toca ni borra datos. Idempotente (IF NOT EXISTS).
 */
export default {
  id: '20261119_0836_crm_contacts_email_key',
  up: async (c) => {
    await c.execute('CREATE INDEX IF NOT EXISTS idx_crm_contacts_email_key ON crm_contacts(user_id, lower(trim(email)))');
  },
} satisfies Migration;
