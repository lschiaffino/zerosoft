import type { Migration } from '../migrations';

/**
 * Mail de resumen de cada deploy de producción (lib/deploy-notify.ts): una fila por deploy, con el sha como clave.
 * El cron de cada minuto la toma antes de mandar (claimed_at, attempts) y la cierra al terminar (done_at). `mailed`
 * dice si salió un mail (un deploy más viejo que el último avisado se cierra sin mail) y `base_sha` desde qué deploy
 * se contaron los cambios. El próximo mail cuenta desde el último deploy con `mailed = 1`.
 */
export default {
  id: '20261115_1750_deploy_notifications',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS deploy_notifications (
      sha TEXT PRIMARY KEY,
      claimed_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 1,
      done_at INTEGER,
      mailed INTEGER NOT NULL DEFAULT 0,
      base_sha TEXT
    )`);
  },
} satisfies Migration;
