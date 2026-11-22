import type { Migration } from '../migrations';

/**
 * CRM ↔ HubSpot, bloque S3: zerosoft → HubSpot. Aditiva e idempotente; nada
 * se escribe en HubSpot hasta que un admin prende "Escribir en HubSpot".
 *
 * - crm_hubspot_outbound: el estado de la salida por workspace (una fila):
 *   modo ('off' | 'on'), la definición de propiedades de HubSpot que se usa
 *   para convertir valores, conteos, códigos de error (nunca datos), el turno
 *   del cron (locked_until) y la espera ante límites (next_run_at), y la
 *   última vista previa (solo nombres de campos y conteos).
 * - crm_hubspot_outbox: la cola. Una fila por registro cambiado acá
 *   (to_object = '') o por asociación agregada acá (to_object/to_id). No
 *   guarda valores: al vaciarla se compara el registro con el shadow del
 *   vínculo. `version` cambia con cada cambio nuevo, así una vuelta que leyó
 *   una versión vieja no borra la fila de un cambio posterior.
 *
 * Triggers (sin tocar lib/crm.ts): cualquier alta o cambio de un campo que se
 * sincroniza en contactos, empresas y negocios, y cualquier asociación nueva,
 * entra a la cola, pero solo en un workspace con la escritura prendida (el
 * WHEN mira crm_hubspot_outbound por clave primaria). Lo que escribe el sync
 * de entrada también entra; al vaciarla no hay diferencia con el shadow y no
 * sale nada. Borrar un registro acá solo marca su vínculo ('deleted_here');
 * restaurarlo de la papelera lo vuelve a 'linked'. Nunca se borra en HubSpot.
 */

const RECORDS = [
  {
    table: 'crm_contacts',
    object: 'contact',
    cols: 'first_name, last_name, email, phone, job_title, website, city, country, lifecycle_stage, lead_status, owner_id, custom',
  },
  {
    table: 'crm_companies',
    object: 'company',
    cols: 'name, domain, industry, employees, phone, website, city, country, lifecycle_stage, owner_id, custom',
  },
  {
    table: 'crm_deals',
    object: 'deal',
    cols: 'name, stage_id, pipeline_id, amount, currency, close_date, description, lost_reason, owner_id, custom',
  },
] as const;

const writing = (ws: string) => `EXISTS (SELECT 1 FROM crm_hubspot_outbound o WHERE o.user_id = ${ws} AND o.mode = 'on')`;

function enqueue(ws: string, object: string, id: string, toObject = "''", toId = "''"): string {
  return `INSERT INTO crm_hubspot_outbox (user_id, object, record_id, to_object, to_id, version, attempts, next_at, code, state, queued_at)
    VALUES (${ws}, '${object}', ${id}, ${toObject}, ${toId}, lower(hex(randomblob(8))), 0, '', '', 'pending', datetime('now'))
    ON CONFLICT(user_id, object, record_id, to_object, to_id) DO UPDATE SET version = excluded.version, attempts = 0, next_at = '', code = '', state = 'pending', queued_at = excluded.queued_at;`;
}

export default {
  id: '20261121_1947_crm_hubspot_outbound',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS crm_hubspot_outbound (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        mode TEXT NOT NULL DEFAULT 'off',
        portal_id TEXT NOT NULL DEFAULT '',
        props TEXT NOT NULL DEFAULT '{}',
        props_at TEXT,
        counts TEXT NOT NULL DEFAULT '{}',
        errors TEXT NOT NULL DEFAULT '[]',
        failure TEXT NOT NULL DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        next_run_at TEXT,
        preview TEXT NOT NULL DEFAULT '{}',
        preview_at TEXT,
        enabled_by TEXT NOT NULL DEFAULT '',
        enabled_at TEXT,
        last_run_at TEXT,
        last_success_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS crm_hubspot_outbox (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        object TEXT NOT NULL,
        record_id TEXT NOT NULL,
        to_object TEXT NOT NULL DEFAULT '',
        to_id TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_at TEXT NOT NULL DEFAULT '',
        code TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'pending',
        creating_at TEXT,
        queued_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, object, record_id, to_object, to_id)
      );
      CREATE INDEX IF NOT EXISTS idx_crm_hubspot_outbox_due ON crm_hubspot_outbox(user_id, state, next_at);
    `);
    for (const r of RECORDS) {
      await c.executeMultiple(`
        CREATE TRIGGER IF NOT EXISTS trg_${r.table}_hs_out_ins AFTER INSERT ON ${r.table} BEGIN
          UPDATE crm_hubspot_links SET state = 'linked', updated_at = datetime('now')
            WHERE user_id = NEW.user_id AND object = '${r.object}' AND record_id = NEW.id AND state = 'deleted_here';
        END;
        CREATE TRIGGER IF NOT EXISTS trg_${r.table}_hs_out_ins_q AFTER INSERT ON ${r.table} WHEN ${writing('NEW.user_id')} BEGIN
          ${enqueue('NEW.user_id', r.object, 'NEW.id')}
        END;
        CREATE TRIGGER IF NOT EXISTS trg_${r.table}_hs_out_upd AFTER UPDATE OF ${r.cols} ON ${r.table} WHEN ${writing('NEW.user_id')} BEGIN
          ${enqueue('NEW.user_id', r.object, 'NEW.id')}
        END;
        CREATE TRIGGER IF NOT EXISTS trg_${r.table}_hs_out_del AFTER DELETE ON ${r.table} BEGIN
          UPDATE crm_hubspot_links SET state = 'deleted_here', updated_at = datetime('now')
            WHERE user_id = OLD.user_id AND object = '${r.object}' AND record_id = OLD.id AND state = 'linked';
          DELETE FROM crm_hubspot_outbox WHERE user_id = OLD.user_id AND object = '${r.object}' AND record_id = OLD.id;
        END;
      `);
    }
    await c.executeMultiple(`
      CREATE TRIGGER IF NOT EXISTS trg_crm_contact_companies_hs_out_ins AFTER INSERT ON crm_contact_companies WHEN ${writing('NEW.user_id')} BEGIN
        ${enqueue('NEW.user_id', 'contact', 'NEW.contact_id', "'company'", 'NEW.company_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS trg_crm_contact_companies_hs_out_upd AFTER UPDATE OF contact_id, company_id ON crm_contact_companies WHEN ${writing('NEW.user_id')} BEGIN
        ${enqueue('NEW.user_id', 'contact', 'NEW.contact_id', "'company'", 'NEW.company_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS trg_crm_deal_companies_hs_out_ins AFTER INSERT ON crm_deal_companies WHEN ${writing('NEW.user_id')} BEGIN
        ${enqueue('NEW.user_id', 'deal', 'NEW.deal_id', "'company'", 'NEW.company_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS trg_crm_deal_companies_hs_out_upd AFTER UPDATE OF deal_id, company_id ON crm_deal_companies WHEN ${writing('NEW.user_id')} BEGIN
        ${enqueue('NEW.user_id', 'deal', 'NEW.deal_id', "'company'", 'NEW.company_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS trg_crm_deal_contacts_hs_out_ins AFTER INSERT ON crm_deal_contacts
        WHEN ${writing('(SELECT d.user_id FROM crm_deals d WHERE d.id = NEW.deal_id)')} BEGIN
        ${enqueue('(SELECT d.user_id FROM crm_deals d WHERE d.id = NEW.deal_id)', 'deal', 'NEW.deal_id', "'contact'", 'NEW.contact_id')}
      END;
      CREATE TRIGGER IF NOT EXISTS trg_crm_deal_contacts_hs_out_upd AFTER UPDATE OF deal_id, contact_id ON crm_deal_contacts
        WHEN ${writing('(SELECT d.user_id FROM crm_deals d WHERE d.id = NEW.deal_id)')} BEGIN
        ${enqueue('(SELECT d.user_id FROM crm_deals d WHERE d.id = NEW.deal_id)', 'deal', 'NEW.deal_id', "'contact'", 'NEW.contact_id')}
      END;
    `);
  },
} satisfies Migration;
