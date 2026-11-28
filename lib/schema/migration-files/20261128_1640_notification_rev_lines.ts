import type { Migration } from '../migrations';

/**
 * Los avisos de chats de Lines también se filtran por el acceso de hoy
 * (lib/notification-access.ts), así que un cambio de acceso a Lines sube la
 * versión de la campana (notification_rev) de las personas del workspace:
 * acceso a líneas o grupos de líneas, visibilidad u owner de una línea,
 * equipos de Lines, acceso por etiqueta, ajustes de la plataforma y Apps del
 * workspace; y de quien recibe o deja de tener un chat asignado. Triggers,
 * para cubrir todos los caminos.
 */
const bumpOne = (who: string) => `INSERT INTO notification_rev (user_id, rev) SELECT ${who}, 1 WHERE ${who} IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET rev = rev + 1;`;
/** Sube la de todas las personas del workspace `ws` (owner y miembros de sus teams). */
const bumpWorkspace = (ws: string) =>
  `INSERT INTO notification_rev (user_id, rev) SELECT u, 1 FROM (
     SELECT m.user_id AS u FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ${ws}
     UNION SELECT ${ws} AS u
   ) WHERE u IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET rev = rev + 1;`;
const numberWs = (numberId: string) => `(SELECT user_id FROM groups_numbers WHERE id = ${numberId})`;
const lineGroupWs = (groupId: string) => `(SELECT user_id FROM groups_line_groups WHERE id = ${groupId})`;

const TRIGGERS: ReadonlyArray<readonly [string, string]> = [
  ['trg_notif_rev_lines_number_access_ins', `AFTER INSERT ON groups_number_access BEGIN ${bumpWorkspace(numberWs('NEW.number_id'))} END`],
  ['trg_notif_rev_lines_number_access_del', `AFTER DELETE ON groups_number_access BEGIN ${bumpWorkspace(numberWs('OLD.number_id'))} END`],
  ['trg_notif_rev_lines_number_upd', `AFTER UPDATE OF visibility, owner_id, line_group_id ON groups_numbers BEGIN ${bumpWorkspace('NEW.user_id')} END`],
  ['trg_notif_rev_lines_group_access_ins', `AFTER INSERT ON groups_line_group_access BEGIN ${bumpWorkspace(lineGroupWs('NEW.group_id'))} END`],
  ['trg_notif_rev_lines_group_access_del', `AFTER DELETE ON groups_line_group_access BEGIN ${bumpWorkspace(lineGroupWs('OLD.group_id'))} END`],
  ['trg_notif_rev_lines_team_ins', `AFTER INSERT ON groups_team_members BEGIN ${bumpOne('NEW.person_id')} END`],
  ['trg_notif_rev_lines_team_del', `AFTER DELETE ON groups_team_members BEGIN ${bumpOne('OLD.person_id')} END`],
  ['trg_notif_rev_lines_label_access_ins', `AFTER INSERT ON groups_label_access BEGIN ${bumpOne('NEW.person_id')} END`],
  ['trg_notif_rev_lines_label_access_del', `AFTER DELETE ON groups_label_access BEGIN ${bumpOne('OLD.person_id')} END`],
  ['trg_notif_rev_lines_platform_ins', `AFTER INSERT ON groups_platform BEGIN ${bumpWorkspace('NEW.user_id')} END`],
  ['trg_notif_rev_lines_platform_upd', `AFTER UPDATE ON groups_platform BEGIN ${bumpWorkspace('NEW.user_id')} END`],
  ['trg_notif_rev_workspace_apps_ins', `AFTER INSERT ON workspace_apps BEGIN ${bumpWorkspace('NEW.owner_id')} END`],
  ['trg_notif_rev_workspace_apps_upd', `AFTER UPDATE ON workspace_apps BEGIN ${bumpWorkspace('NEW.owner_id')} END`],
  ['trg_notif_rev_workspace_apps_del', `AFTER DELETE ON workspace_apps BEGIN ${bumpWorkspace('OLD.owner_id')} END`],
  [
    'trg_notif_rev_lines_chat_assign',
    `AFTER UPDATE OF assigned_to ON groups_chats WHEN COALESCE(OLD.assigned_to, '') != COALESCE(NEW.assigned_to, '') BEGIN ${bumpOne('OLD.assigned_to')} ${bumpOne('NEW.assigned_to')} END`,
  ],
  ['trg_notif_rev_lines_chat_line', `AFTER UPDATE OF number_id ON groups_chats WHEN OLD.number_id != NEW.number_id BEGIN ${bumpWorkspace('NEW.user_id')} END`],
];

export default {
  id: '20261128_1640_notification_rev_lines',
  async up(client) {
    await client.execute('CREATE TABLE IF NOT EXISTS notification_rev (user_id TEXT PRIMARY KEY, rev INTEGER NOT NULL DEFAULT 0)');
    for (const [name, body] of TRIGGERS) await client.execute(`CREATE TRIGGER IF NOT EXISTS ${name} ${body}`);
  },
} satisfies Migration;
