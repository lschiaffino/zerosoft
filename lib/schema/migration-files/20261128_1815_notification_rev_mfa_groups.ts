import type { Migration } from '../migrations';

/**
 * Los avisos se filtran por el acceso de hoy a cada app (lib/notification-access.ts,
 * lib/workspace-apps personCanUseApp), y ese acceso también cambia cuando la
 * persona prende o apaga la verificación en dos pasos (un workspace que la
 * exige) o entra o sale de un equipo del workspace (Apps del workspace "para
 * algunos"). Esos cambios suben su versión de la campana (notification_rev),
 * como los de 20261128_1640_notification_rev_lines.
 */
const bumpOne = (who: string) => `INSERT INTO notification_rev (user_id, rev) SELECT ${who}, 1 WHERE ${who} IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET rev = rev + 1;`;

const TRIGGERS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'users',
    'trg_notif_rev_user_mfa',
    `AFTER UPDATE OF mfa_enabled_at ON users WHEN OLD.mfa_enabled_at IS NOT NEW.mfa_enabled_at BEGIN ${bumpOne('NEW.id')} END`,
  ],
  ['workspace_group_members', 'trg_notif_rev_ws_group_ins', `AFTER INSERT ON workspace_group_members BEGIN ${bumpOne('NEW.user_id')} END`],
  ['workspace_group_members', 'trg_notif_rev_ws_group_del', `AFTER DELETE ON workspace_group_members BEGIN ${bumpOne('OLD.user_id')} END`],
];

export default {
  id: '20261128_1815_notification_rev_mfa_groups',
  async up(client) {
    await client.execute('CREATE TABLE IF NOT EXISTS notification_rev (user_id TEXT PRIMARY KEY, rev INTEGER NOT NULL DEFAULT 0)');
    for (const [table, name, body] of TRIGGERS) {
      // Una base sin la tabla (tests viejos) no tiene a quién avisar.
      const exists = await client.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", args: [table] });
      if (exists.rows.length) await client.execute(`CREATE TRIGGER IF NOT EXISTS ${name} ${body}`);
    }
  },
} satisfies Migration;
