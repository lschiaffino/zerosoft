/**
 * Orden de la búsqueda en las listas de chats (Inbox y Lines), como en
 * WhatsApp: primero los chats cuyo nombre coincide, después los que solo
 * coinciden por el texto de algún mensaje.
 *
 * El rango es un carácter que se antepone a la clave de orden por actividad,
 * así el cursor (clave, id) de la lista sirve igual con búsqueda:
 *   '2' el nombre empieza con lo buscado, o una de sus palabras;
 *   '1' el nombre lo contiene en otra parte, o coincide el teléfono o la dirección;
 *   '0' coincide solo por mensajes (o por la vista previa).
 */
export interface SearchRank {
  sql: string;
  args: string[];
}

export const MESSAGE_ONLY_RANK = '0';

function esc(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Expresión SQL del rango ('2', '1' o '0') para las columnas de nombre y teléfono o dirección del chat. */
export function chatNameRank(nameCol: string, handleCol: string, text: string): SearchRank {
  const e = esc(text.trim());
  return {
    sql: `(CASE WHEN ${nameCol} LIKE ? ESCAPE '\\' OR ${nameCol} LIKE ? ESCAPE '\\' THEN '2' WHEN ${nameCol} LIKE ? ESCAPE '\\' OR ${handleCol} LIKE ? ESCAPE '\\' THEN '1' ELSE '0' END)`,
    args: [`${e}%`, `% ${e}%`, `%${e}%`, `%${e}%`],
  };
}

/** La fila coincide por nombre, teléfono o dirección (su clave de orden de búsqueda no empieza con '0'). */
export function isNameHit(sortKey: string | null | undefined): boolean {
  return Boolean(sortKey) && String(sortKey)[0] !== MESSAGE_ONLY_RANK;
}
