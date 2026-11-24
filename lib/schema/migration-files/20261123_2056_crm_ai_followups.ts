import type { Migration } from '../migrations';

/**
 * CRM, bloque C5: propuestas de la IA después de una llamada o reunión
 * (lib/crm-ai-followup.ts).
 *
 * - crm_ai_followups: una fila por propuesta (propiedad, etapa, email o
 *   tarea). `user_id` es el workspace y `person_id` quien la pidió: solo esa
 *   persona la ve. `status` pasa de pending a applied o discarded con
 *   compare-and-set. Cae con la actividad (FK en cascada).
 * - crm_ai_followup_runs: cuándo la persona pidió propuestas para la
 *   actividad (para distinguir "sin propuestas" de "nunca se pidió").
 *
 * Idempotente: tablas e índices con IF NOT EXISTS.
 */
export default {
  id: '20261123_2056_crm_ai_followups',
  up: async (c) => {
    await c.execute(`
      CREATE TABLE IF NOT EXISTS crm_ai_followups (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL REFERENCES crm_activities(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('field', 'stage', 'email', 'task')),
        position INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'discarded')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_crm_ai_followups_activity ON crm_ai_followups(activity_id, person_id, position)');
    await c.execute(`
      CREATE TABLE IF NOT EXISTS crm_ai_followup_runs (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL REFERENCES crm_activities(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, activity_id, person_id)
      )
    `);
  },
} satisfies Migration;
