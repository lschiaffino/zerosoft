import type { Migration } from '../migrations';

/**
 * La campana responde 304 mientras no cambie notification_rev de la persona
 * (lib/notification-rev.ts). Los avisos se filtran por el acceso de hoy
 * (lib/notification-access.ts), así que un cambio de acceso también tiene que
 * subir la versión: dejar un team, que un team pase a privado o vuelva, sumar
 * o sacar un acceso a un team privado, ser o dejar de ser invitada, y mover
 * un project o una iniciativa de workspace. Triggers, para cubrir todos los
 * caminos (también los borrados en cascada).
 */
const bumpOne = (who: string) => `INSERT INTO notification_rev (user_id, rev) VALUES (${who}, 1) ON CONFLICT(user_id) DO UPDATE SET rev = rev + 1;`;
/** Sube la de todas las personas de `select` (una columna user_id). */
const bumpMany = (select: string) =>
  `INSERT INTO notification_rev (user_id, rev) SELECT u, 1 FROM (${select}) WHERE u IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET rev = rev + 1;`;
/** Las personas de un workspace (team o personal). */
const people = (team: string, owner: string) =>
  `SELECT user_id AS u FROM team_members WHERE team_id = ${team} UNION SELECT owner_id AS u FROM teams WHERE id = ${team} UNION SELECT ${owner} AS u`;
const byEmail = (email: string) => `SELECT id AS u FROM users WHERE lower(email) = ${email}`;

const TRIGGERS: ReadonlyArray<readonly [string, string]> = [
  ['trg_notif_rev_member_delete', `AFTER DELETE ON team_members BEGIN ${bumpOne('OLD.user_id')} END`],
  ['trg_notif_rev_member_insert', `AFTER INSERT ON team_members BEGIN ${bumpOne('NEW.user_id')} END`],
  [
    'trg_notif_rev_team_visibility',
    `AFTER UPDATE OF visibility, team_id ON track_projects BEGIN ${bumpMany(people('NEW.team_id', 'NEW.owner_id'))} ${bumpMany(people('OLD.team_id', 'OLD.owner_id'))} END`,
  ],
  ['trg_notif_rev_access_insert', `AFTER INSERT ON track_project_access BEGIN ${bumpOne('NEW.user_id')} END`],
  ['trg_notif_rev_access_delete', `AFTER DELETE ON track_project_access BEGIN ${bumpOne('OLD.user_id')} END`],
  ['trg_notif_rev_guest_insert', `AFTER INSERT ON track_guests BEGIN ${bumpMany(byEmail('NEW.email'))} END`],
  ['trg_notif_rev_guest_update', `AFTER UPDATE ON track_guests BEGIN ${bumpMany(byEmail('NEW.email'))} END`],
  ['trg_notif_rev_guest_delete', `AFTER DELETE ON track_guests BEGIN ${bumpMany(byEmail('OLD.email'))} END`],
  [
    'trg_notif_rev_plan_move',
    `AFTER UPDATE OF team_id, owner_id ON track_plans BEGIN ${bumpMany(people('NEW.team_id', 'NEW.owner_id'))} ${bumpMany(people('OLD.team_id', 'OLD.owner_id'))} END`,
  ],
  [
    'trg_notif_rev_initiative_move',
    `AFTER UPDATE OF team_id, owner_id ON track_initiatives BEGIN ${bumpMany(people('NEW.team_id', 'NEW.owner_id'))} ${bumpMany(people('OLD.team_id', 'OLD.owner_id'))} END`,
  ],
];

export default {
  id: '20261123_0545_notification_rev_access',
  async up(client) {
    await client.execute('CREATE TABLE IF NOT EXISTS notification_rev (user_id TEXT PRIMARY KEY, rev INTEGER NOT NULL DEFAULT 0)');
    for (const [name, body] of TRIGGERS) await client.execute(`CREATE TRIGGER IF NOT EXISTS ${name} ${body}`);
  },
} satisfies Migration;
