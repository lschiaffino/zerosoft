import type { Migration } from '../migrations';

/**
 * Lines e Inbox: un envío con su clientId lo manda una sola instancia del servidor a la vez. La clave
 * (`lines:<chat>:<clientId>` o `inbox:<chat>:<clientId>`) se toma antes de mandar a WhatsApp: queda `done` si salió y
 * se suelta si falló. Otra instancia que recibe el mismo envío (un reintento de la cola sin conexión mientras el
 * primero sigue saliendo) espera y devuelve el mensaje guardado en vez de mandarlo otra vez (lib/send-once.ts). El
 * cron horario borra las de más de un día.
 */
export default {
  id: '20261115_1100_send_claims',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS send_claims (
      key TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      done INTEGER NOT NULL DEFAULT 0
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_send_claims_created ON send_claims(created_at)');
  },
} satisfies Migration;
