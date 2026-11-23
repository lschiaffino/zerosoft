import type { Migration } from '../migrations';
import { CRM_LIVE_SKIP_COLUMNS, crmLiveBumpSql } from '../../crm-live-sql';

/**
 * CRM en vivo (bloque C3). Aditiva e idempotente.
 *
 * - crm_live_rev: un contador por workspace que sube con cada cambio en
 *   contactos, empresas, negocios, leads, sus asociaciones y las notas.
 * - crm_live_changes: una fila por registro tocado, con el valor del contador
 *   de su último cambio (y queda al borrarlo, así quien lo mira se entera).
 *
 * Triggers (sin tocar lib/crm.ts): cualquier alta, cambio o baja, venga de
 * donde venga (la ficha, la tabla, la API, el import, el sync de HubSpot).
 * Las pantallas abiertas preguntan "¿cambió algo de lo que muestro desde el
 * contador N?" leyendo una fila por clave primaria (lib/crm-live.ts).
 *
 * Los UPDATE miran solo las columnas que se ven: las de mantenimiento
 * (score_updated_at, enriched_at) no cuentan, así un render que las toca no
 * dispara recargas en las demás pantallas. Sin FK a users: un trigger que
 * corre dentro del borrado en cascada de un workspace no debe frenarlo.
 */

const RECORDS = [
  { table: 'crm_contacts', entity: 'contact' },
  { table: 'crm_companies', entity: 'company' },
  { table: 'crm_deals', entity: 'deal' },
  { table: 'crm_leads', entity: 'lead' },
] as const;

export default {
  id: '20261123_0440_crm_live',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS crm_live_rev (
        user_id TEXT PRIMARY KEY,
        rev INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS crm_live_changes (
        user_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        rev INTEGER NOT NULL,
        PRIMARY KEY (user_id, entity, record_id)
      );
      CREATE INDEX IF NOT EXISTS idx_crm_live_changes_rev ON crm_live_changes(user_id, rev);
    `);
    for (const r of RECORDS) {
      const info = await c.execute(`PRAGMA table_info(${r.table})`);
      const cols = info.rows.map((row) => String(row.name)).filter((n) => !CRM_LIVE_SKIP_COLUMNS.includes(n));
      if (!cols.length) continue;
      await c.executeMultiple(`
        CREATE TRIGGER IF NOT EXISTS trg_${r.table}_live_ins AFTER INSERT ON ${r.table} BEGIN
          ${crmLiveBumpSql('NEW.user_id', [[r.entity, 'NEW.id']])}
        END;
        CREATE TRIGGER IF NOT EXISTS trg_${r.table}_live_upd AFTER UPDATE OF ${cols.join(', ')} ON ${r.table} BEGIN
          ${crmLiveBumpSql('NEW.user_id', [[r.entity, 'NEW.id']])}
        END;
        CREATE TRIGGER IF NOT EXISTS trg_${r.table}_live_del AFTER DELETE ON ${r.table} BEGIN
          ${crmLiveBumpSql('OLD.user_id', [[r.entity, 'OLD.id']])}
        END;
      `);
    }
    // Asociaciones: se ven en las dos fichas.
    const dealWs = (ref: 'NEW' | 'OLD') => `(SELECT d.user_id FROM crm_deals d WHERE d.id = ${ref}.deal_id)`;
    const assoc = [
      { table: 'crm_contact_companies', ws: (ref: 'NEW' | 'OLD') => `${ref}.user_id`, a: ['contact', 'contact_id'], b: ['company', 'company_id'] },
      { table: 'crm_deal_companies', ws: (ref: 'NEW' | 'OLD') => `${ref}.user_id`, a: ['deal', 'deal_id'], b: ['company', 'company_id'] },
      { table: 'crm_deal_contacts', ws: dealWs, a: ['deal', 'deal_id'], b: ['contact', 'contact_id'] },
    ] as const;
    for (const x of assoc) {
      const exists = await c.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", args: [x.table] });
      if (!exists.rows.length) continue;
      const pairs = (ref: 'NEW' | 'OLD'): Array<[string, string]> => [
        [x.a[0], `${ref}.${x.a[1]}`],
        [x.b[0], `${ref}.${x.b[1]}`],
      ];
      await c.executeMultiple(`
        CREATE TRIGGER IF NOT EXISTS trg_${x.table}_live_ins AFTER INSERT ON ${x.table} BEGIN
          ${crmLiveBumpSql(x.ws('NEW'), pairs('NEW'))}
        END;
        CREATE TRIGGER IF NOT EXISTS trg_${x.table}_live_upd AFTER UPDATE ON ${x.table} BEGIN
          ${crmLiveBumpSql(x.ws('NEW'), pairs('NEW'))}
        END;
        CREATE TRIGGER IF NOT EXISTS trg_${x.table}_live_del AFTER DELETE ON ${x.table} BEGIN
          ${crmLiveBumpSql(x.ws('OLD'), pairs('OLD'))}
        END;
      `);
    }
    // Notas y actividades: el alta, la baja y los cambios de fecha ya tocan el registro
    // (lib/crm-activity-dates.ts); editar el texto de una nota no, y se ve en la ficha.
    const parents = (ref: 'NEW' | 'OLD'): Array<[string, string]> => [
      ['contact', `${ref}.contact_id`],
      ['company', `${ref}.company_id`],
      ['deal', `${ref}.deal_id`],
    ];
    await c.executeMultiple(`
      CREATE TRIGGER IF NOT EXISTS trg_crm_activities_live_text AFTER UPDATE OF subject, body ON crm_activities BEGIN
        ${crmLiveBumpSql('NEW.user_id', parents('NEW'))}
      END;
    `);
  },
} satisfies Migration;
