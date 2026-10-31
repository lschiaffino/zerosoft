/** Notes: tipos y agrupado de tareas (puro: lo usan el servidor y el cliente). */
export interface NoteTask {
  note_id: string;
  note_title: string;
  block_id: string;
  text: string;
  checked: boolean;
  /** YYYY-MM-DD */
  due: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  /** La nota es mía (si no, me la asignaron). */
  mine: boolean;
}

export interface NoteTaskMeta {
  due: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
}

export type TaskGroupKey = 'overdue' | 'today' | 'upcoming' | 'noDate' | 'done';
export const TASK_GROUPS: readonly TaskGroupKey[] = ['overdue', 'today', 'upcoming', 'noDate', 'done'];

export function groupTasks(tasks: NoteTask[], today: string): Record<TaskGroupKey, NoteTask[]> {
  const out: Record<TaskGroupKey, NoteTask[]> = { overdue: [], today: [], upcoming: [], noDate: [], done: [] };
  for (const t of tasks) {
    if (t.checked) out.done.push(t);
    else if (!t.due) out.noDate.push(t);
    else if (t.due < today) out.overdue.push(t);
    else if (t.due === today) out.today.push(t);
    else out.upcoming.push(t);
  }
  const byDue = (a: NoteTask, b: NoteTask) => (a.due ?? '').localeCompare(b.due ?? '');
  out.overdue.sort(byDue);
  out.upcoming.sort(byDue);
  return out;
}

/** Hoy en la zona del navegador (YYYY-MM-DD). */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
