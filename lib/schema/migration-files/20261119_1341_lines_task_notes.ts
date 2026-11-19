import type { Migration } from '../migrations';

/**
 * Lines: las tareas creadas desde un chat guardaban, en las notas de la tarea
 * del CRM, una copia del nombre del chat y del texto del mensaje cuando la
 * persona no escribía notas. Ahora el origen es solo el vínculo (groups_tasks
 * y task_links) y el chat y el mensaje se leen con el acceso a ese chat.
 *
 * Esta migración vacía las notas que eran esa copia automática. Las que
 * escribió una persona quedan como están. Idempotente: una nota ya vacía no
 * se toca.
 */

interface Row {
  activity_id: string;
  body: string;
  message_body: string | null;
  chat_name: string | null;
  chat_phone: string | null;
  chat_pid: string | null;
}

/** ¿Estas notas son la copia automática ("<chat>" o "<chat>: <mensaje>") y no algo que escribió una persona? */
export function isCopiedTaskNote(r: Omit<Row, 'activity_id'>): boolean {
  const body = r.body;
  if (!body) return false;
  const names = [r.chat_name ?? '', r.chat_phone ? `+${r.chat_phone}` : '', r.chat_pid ?? ''].filter(Boolean);
  // Sin mensaje (o con un mensaje sin texto): la copia era solo el nombre del chat.
  if (names.includes(body)) return true;
  const message = (r.message_body ?? '').slice(0, 1000);
  if (!message) return false;
  // Con mensaje: "<chat>: <hasta 1000 caracteres>". Las menciones ("@<dígitos>") se guardaban con el nombre, así
  // que se compara hasta la primera; el nombre del chat pudo cambiar, así que alcanza con el separador.
  const at = message.indexOf('@');
  const stem = at >= 0 ? message.slice(0, at) : message;
  for (let i = body.indexOf(': '); i >= 0 && i <= 400; i = body.indexOf(': ', i + 1)) {
    const rest = body.slice(i + 2);
    if (at < 0 ? rest === message : rest.startsWith(stem) && (stem.length >= 8 || names.includes(body.slice(0, i)))) return true;
  }
  return false;
}

export default {
  id: '20261119_1341_lines_task_notes',
  up: async (c) => {
    const res = await c.execute(
      `SELECT t.activity_id, a.body, m.body AS message_body, ch.name AS chat_name, ch.phone AS chat_phone, ch.provider_chat_id AS chat_pid
       FROM groups_tasks t
       JOIN crm_activities a ON a.id = t.activity_id
       LEFT JOIN groups_chats ch ON ch.id = t.chat_id
       LEFT JOIN groups_messages m ON m.id = t.message_id
       WHERE a.body IS NOT NULL AND a.body <> ''`,
    );
    for (const raw of res.rows) {
      const r = raw as unknown as Row;
      if (!isCopiedTaskNote({ ...r, body: String(r.body ?? '') })) continue;
      // Solo si las notas siguen siendo las que se leyeron (dos corridas a la vez, o alguien que las edita).
      await c.execute({ sql: "UPDATE crm_activities SET body = '' WHERE id = ? AND body = ?", args: [r.activity_id, String(r.body)] });
    }
  },
} satisfies Migration;
