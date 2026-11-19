/**
 * Lines: de quién es una carpeta que todavía no tiene dueño (owner_id NULL).
 * Lo usan la migración 20261119_1737_lines_personal_folders y, mientras quede
 * alguna instancia vieja escribiendo carpetas sin dueño, las lecturas de
 * lib/groups-lines.ts (que las reparan antes de listar).
 *
 * La regla: quien la creó (created_by), si hoy es el dueño del workspace o una
 * persona de alguno de sus equipos (invitados incluidos: pueden usar Lines);
 * si no quedó anotado, o esa persona ya no está en el workspace, el dueño del
 * workspace (user_id). Así ninguna carpeta queda a nombre de alguien que ya no
 * puede entrar a verla.
 */
export const FOLDER_OWNER_SQL = `CASE WHEN f.created_by <> '' AND (f.created_by = f.user_id OR EXISTS (
    SELECT 1 FROM team_members zfm JOIN teams zft ON zft.id = zfm.team_id
    WHERE zft.owner_id = f.user_id AND zfm.user_id = f.created_by)) THEN f.created_by ELSE f.user_id END`;

/**
 * Los dos pasos, en orden: lo que estaba en groups_chats.folder_id pasa a la
 * persona dueña de la carpeta, y recién después la carpeta recibe su dueño.
 * Solo toca carpetas sin dueño: repetirlo, o correrlo dos a la vez, no duplica
 * (clave persona + chat) ni pisa lo que la persona movió después. No borra ni
 * cambia la columna de antes. Con `scoped`, solo las de un workspace (un `?`
 * por sentencia).
 */
export function folderOwnerBackfill(scoped: boolean): [string, string] {
  const ws = scoped ? ' AND f.user_id = ?' : '';
  return [
    `INSERT OR IGNORE INTO groups_chat_folders (user_id, person_id, chat_id, folder_id)
     SELECT c.user_id, ${FOLDER_OWNER_SQL}, c.id, c.folder_id
     FROM groups_chats c JOIN groups_folders f ON f.id = c.folder_id AND f.user_id = c.user_id
     WHERE c.folder_id IS NOT NULL AND f.owner_id IS NULL${ws}`,
    `UPDATE groups_folders AS f SET owner_id = ${FOLDER_OWNER_SQL} WHERE f.owner_id IS NULL${ws}`,
  ];
}
