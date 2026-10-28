/**
 * Espejo de los subequipos del workspace (workspace_groups) en las tablas de
 * equipos que ya usa cada app: crm_sales_teams (visibilidad y round-robin del
 * CRM), chat_teams (pools e inbox de Chat) y groups_teams (asignación de
 * Groups). Mismo id en todas: las reglas que nombran un equipo siguen
 * valiendo y el código de cada app no cambia.
 *
 * Sin dependencias de la base: recibe un `exec` (la migración usa el client de
 * libsql, la app getDb()). Las tablas que no existen se saltean.
 */
export type MirrorExec = (sql: string, args?: Array<string | number | null>) => Promise<unknown>;

const APP_TABLES = ['crm_sales_teams', 'chat_teams', 'groups_teams'] as const;

async function safe(exec: MirrorExec, sql: string, args: Array<string | number | null> = []): Promise<void> {
  try {
    await exec(sql, args);
  } catch (err) {
    // Una tabla de una app que todavía no existe (base vieja de tests) no corta el resto.
    if (!/no such table/i.test(String(err))) throw err;
  }
}

/**
 * Copia (o actualiza) el subequipo y sus miembros en las tablas de las apps.
 * `groupId` null = todos los del workspace `workspaceId` (o de toda la base si
 * también es null: la migración).
 */
export async function mirrorGroups(
  exec: MirrorExec,
  opts: { workspaceId?: string | null; groupId?: string | null; prune?: boolean } = {},
): Promise<void> {
  // La migración no poda: solo suma (nada de lo que había en una app se borra).
  const prune = opts.prune !== false;
  const where = opts.groupId ? 'g.id = ?' : opts.workspaceId ? 'g.workspace_id = ?' : '1 = 1';
  const arg = opts.groupId ? [opts.groupId] : opts.workspaceId ? [opts.workspaceId] : [];

  // Equipos: alta con el mismo id y el nombre al día.
  await safe(exec, `INSERT OR IGNORE INTO crm_sales_teams (id, user_id, name, created_at) SELECT g.id, g.workspace_id, g.name, g.created_at FROM workspace_groups g WHERE ${where}`, arg);
  await safe(
    exec,
    `INSERT OR IGNORE INTO chat_teams (id, workspace_id, name, created_at, updated_at) SELECT g.id, g.workspace_id, g.name, g.created_at, g.updated_at FROM workspace_groups g WHERE ${where}`,
    arg,
  );
  // groups_teams tiene UNIQUE (user_id, name): un nombre repetido no se copia (queda el de Groups).
  await safe(exec, `INSERT OR IGNORE INTO groups_teams (id, user_id, name, created_at) SELECT g.id, g.workspace_id, g.name, g.created_at FROM workspace_groups g WHERE ${where}`, arg);
  for (const table of APP_TABLES) {
    await safe(
      exec,
      `UPDATE OR IGNORE ${table} SET name = (SELECT g.name FROM workspace_groups g WHERE g.id = ${table}.id)
       WHERE id IN (SELECT g.id FROM workspace_groups g WHERE ${where})
         AND name != (SELECT g.name FROM workspace_groups g WHERE g.id = ${table}.id)`,
      arg,
    );
  }

  // Miembros: la lista del workspace manda (alta de los que faltan, baja de los que sobran).
  await safe(
    exec,
    `INSERT OR IGNORE INTO crm_sales_team_members (team_id, user_id, person_id)
     SELECT m.group_id, g.workspace_id, m.user_id FROM workspace_group_members m JOIN workspace_groups g ON g.id = m.group_id
     WHERE ${where} AND EXISTS (SELECT 1 FROM crm_sales_teams x WHERE x.id = g.id)`,
    arg,
  );
  if (prune) await safe(
    exec,
    `DELETE FROM crm_sales_team_members WHERE team_id IN (SELECT g.id FROM workspace_groups g WHERE ${where})
     AND NOT EXISTS (SELECT 1 FROM workspace_group_members m WHERE m.group_id = crm_sales_team_members.team_id AND m.user_id = crm_sales_team_members.person_id)`,
    arg,
  );
  await safe(
    exec,
    `INSERT OR IGNORE INTO chat_team_members (team_id, user_id, created_at)
     SELECT m.group_id, m.user_id, m.created_at FROM workspace_group_members m JOIN workspace_groups g ON g.id = m.group_id
     WHERE ${where} AND EXISTS (SELECT 1 FROM chat_teams x WHERE x.id = g.id)`,
    arg,
  );
  if (prune) await safe(
    exec,
    `DELETE FROM chat_team_members WHERE team_id IN (SELECT g.id FROM workspace_groups g WHERE ${where})
     AND NOT EXISTS (SELECT 1 FROM workspace_group_members m WHERE m.group_id = chat_team_members.team_id AND m.user_id = chat_team_members.user_id)`,
    arg,
  );
  await safe(
    exec,
    `INSERT OR IGNORE INTO groups_team_members (team_id, person_id)
     SELECT m.group_id, m.user_id FROM workspace_group_members m JOIN workspace_groups g ON g.id = m.group_id
     WHERE ${where} AND EXISTS (SELECT 1 FROM groups_teams x WHERE x.id = g.id)`,
    arg,
  );
  if (prune) await safe(
    exec,
    `DELETE FROM groups_team_members WHERE team_id IN (SELECT g.id FROM workspace_groups g WHERE ${where})
     AND NOT EXISTS (SELECT 1 FROM workspace_group_members m WHERE m.group_id = groups_team_members.team_id AND m.user_id = groups_team_members.person_id)`,
    arg,
  );
}

/** Borra el subequipo de las tablas de las apps (las reglas que lo nombraban quedan sin equipo, como al borrarlo en la app). */
export async function unmirrorGroup(exec: MirrorExec, groupId: string): Promise<void> {
  for (const table of APP_TABLES) await safe(exec, `DELETE FROM ${table} WHERE id = ?`, [groupId]);
}
