/**
 * Espejo de los subequipos del workspace (workspace_groups) en las tablas de
 * equipos que ya usa cada app: crm_sales_teams (visibilidad y round-robin del
 * CRM), chat_teams (pools e inbox de Chat) y groups_teams (asignación de
 * Groups). Mismo id en todas: las reglas que nombran un equipo siguen
 * valiendo y el código de cada app no cambia.
 *
 * Es opt-in por app: un subequipo solo existe en la app que figura en su
 * `apps` (JSON, p. ej. ["crm"]). Uno creado en Ajustes no cambia la
 * visibilidad del CRM salvo que se elija usarlo ahí. Los que venían de una
 * app (migración 128) tienen solo esa app: no se copian a las otras.
 *
 * Sin dependencias de la base: recibe un `exec` (la app usa getDb()).
 */
export type MirrorExec = (sql: string, args?: Array<string | number | null>) => Promise<unknown>;

export const MIRROR_APPS = ['crm', 'chat', 'groups'] as const;
export type MirrorApp = (typeof MIRROR_APPS)[number];

async function safe(exec: MirrorExec, sql: string, args: Array<string | number | null> = []): Promise<void> {
  try {
    await exec(sql, args);
  } catch (err) {
    // Una tabla de una app que todavía no existe (base vieja de tests) no corta el resto.
    if (!/no such table/i.test(String(err))) throw err;
  }
}

const uses = (app: MirrorApp) => `EXISTS (SELECT 1 FROM json_each(g.apps) ja WHERE ja.value = '${app}')`;

/**
 * Copia (o actualiza) los subequipos y sus miembros en las apps que los usan
 * y los saca de las que dejaron de usarlos. `groupId` o `workspaceId` acotan.
 */
export async function mirrorGroups(exec: MirrorExec, opts: { workspaceId?: string | null; groupId?: string | null } = {}): Promise<void> {
  const scope = opts.groupId ? 'g.id = ?' : opts.workspaceId ? 'g.workspace_id = ?' : '1 = 1';
  const arg = opts.groupId ? [opts.groupId] : opts.workspaceId ? [opts.workspaceId] : [];
  const on = (app: MirrorApp) => `${scope} AND ${uses(app)}`;
  const off = (app: MirrorApp) => `${scope} AND NOT ${uses(app)}`;

  // CRM
  await safe(exec, `INSERT OR IGNORE INTO crm_sales_teams (id, user_id, name, created_at) SELECT g.id, g.workspace_id, g.name, g.created_at FROM workspace_groups g WHERE ${on('crm')}`, arg);
  await safe(exec, `UPDATE crm_sales_teams SET name = (SELECT g.name FROM workspace_groups g WHERE g.id = crm_sales_teams.id) WHERE id IN (SELECT g.id FROM workspace_groups g WHERE ${on('crm')})`, arg);
  await safe(
    exec,
    `INSERT OR IGNORE INTO crm_sales_team_members (team_id, user_id, person_id)
     SELECT m.group_id, g.workspace_id, m.user_id FROM workspace_group_members m JOIN workspace_groups g ON g.id = m.group_id WHERE ${on('crm')}`,
    arg,
  );
  await safe(
    exec,
    `DELETE FROM crm_sales_team_members WHERE team_id IN (SELECT g.id FROM workspace_groups g WHERE ${on('crm')})
     AND NOT EXISTS (SELECT 1 FROM workspace_group_members m WHERE m.group_id = crm_sales_team_members.team_id AND m.user_id = crm_sales_team_members.person_id)`,
    arg,
  );
  await safe(exec, `DELETE FROM crm_sales_teams WHERE id IN (SELECT g.id FROM workspace_groups g WHERE ${off('crm')})`, arg);

  // Chat
  await safe(
    exec,
    `INSERT OR IGNORE INTO chat_teams (id, workspace_id, name, created_at, updated_at) SELECT g.id, g.workspace_id, g.name, g.created_at, g.updated_at FROM workspace_groups g WHERE ${on('chat')}`,
    arg,
  );
  await safe(exec, `UPDATE chat_teams SET name = (SELECT g.name FROM workspace_groups g WHERE g.id = chat_teams.id) WHERE id IN (SELECT g.id FROM workspace_groups g WHERE ${on('chat')})`, arg);
  await safe(
    exec,
    `INSERT OR IGNORE INTO chat_team_members (team_id, user_id, created_at)
     SELECT m.group_id, m.user_id, m.created_at FROM workspace_group_members m JOIN workspace_groups g ON g.id = m.group_id WHERE ${on('chat')}`,
    arg,
  );
  await safe(
    exec,
    `DELETE FROM chat_team_members WHERE team_id IN (SELECT g.id FROM workspace_groups g WHERE ${on('chat')})
     AND NOT EXISTS (SELECT 1 FROM workspace_group_members m WHERE m.group_id = chat_team_members.team_id AND m.user_id = chat_team_members.user_id)`,
    arg,
  );
  await safe(exec, `UPDATE chat_conversations SET team_id = NULL WHERE team_id IN (SELECT g.id FROM workspace_groups g WHERE ${off('chat')})`, arg);
  await safe(exec, `UPDATE chat_assignment_rules SET assign_team_id = NULL WHERE assign_team_id IN (SELECT g.id FROM workspace_groups g WHERE ${off('chat')})`, arg);
  await safe(exec, `DELETE FROM chat_teams WHERE id IN (SELECT g.id FROM workspace_groups g WHERE ${off('chat')})`, arg);

  // Groups (groups_teams tiene UNIQUE (user_id, name): un nombre repetido no se copia)
  await safe(exec, `INSERT OR IGNORE INTO groups_teams (id, user_id, name, created_at) SELECT g.id, g.workspace_id, g.name, g.created_at FROM workspace_groups g WHERE ${on('groups')}`, arg);
  await safe(exec, `UPDATE OR IGNORE groups_teams SET name = (SELECT g.name FROM workspace_groups g WHERE g.id = groups_teams.id) WHERE id IN (SELECT g.id FROM workspace_groups g WHERE ${on('groups')})`, arg);
  await safe(
    exec,
    `INSERT OR IGNORE INTO groups_team_members (team_id, person_id)
     SELECT m.group_id, m.user_id FROM workspace_group_members m JOIN workspace_groups g ON g.id = m.group_id
     WHERE ${on('groups')} AND EXISTS (SELECT 1 FROM groups_teams x WHERE x.id = g.id)`,
    arg,
  );
  await safe(
    exec,
    `DELETE FROM groups_team_members WHERE team_id IN (SELECT g.id FROM workspace_groups g WHERE ${on('groups')})
     AND NOT EXISTS (SELECT 1 FROM workspace_group_members m WHERE m.group_id = groups_team_members.team_id AND m.user_id = groups_team_members.person_id)`,
    arg,
  );
  await safe(exec, `UPDATE groups_chats SET assigned_team_id = NULL WHERE assigned_team_id IN (SELECT g.id FROM workspace_groups g WHERE ${off('groups')})`, arg);
  await safe(exec, `UPDATE groups_assign_rules SET team_id = NULL, enabled = 0 WHERE team_id IN (SELECT g.id FROM workspace_groups g WHERE ${off('groups')})`, arg);
  await safe(exec, `DELETE FROM groups_teams WHERE id IN (SELECT g.id FROM workspace_groups g WHERE ${off('groups')})`, arg);
}

/** Borra el subequipo de las tablas de las apps. */
export async function unmirrorGroup(exec: MirrorExec, groupId: string): Promise<void> {
  for (const table of ['crm_sales_teams', 'chat_teams', 'groups_teams']) await safe(exec, `DELETE FROM ${table} WHERE id = ?`, [groupId]);
}
