import type { Client } from '@libsql/client';
import type { Migration } from '../migrations';

async function addColumn(client: Client, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}

/**
 * Formularios de pedidos (form templates de Linear): una plantilla de issue
 * con campos propios (texto, texto largo, opciones, casilla) se vuelve un
 * formulario. Quien lo completa crea un issue en triage con las respuestas en
 * la descripción.
 *
 * - track_issue_templates.fields: JSON con la lista de campos ('[]' = una
 *   plantilla común, sin formulario).
 */
export default {
  id: '20261123_2051_track_template_form_fields',
  up: async (c) => {
    await addColumn(c, "ALTER TABLE track_issue_templates ADD COLUMN fields TEXT NOT NULL DEFAULT '[]'");
  },
} satisfies Migration;
