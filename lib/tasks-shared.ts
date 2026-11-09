/**
 * Tareas de la suite: constantes y tipos que usan el servidor y el cliente
 * (sin base). La lógica vive en lib/tasks.ts.
 */
export const TASK_PRIORITIES = ['', 'low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export function cleanPriority(v: unknown): TaskPriority {
  return typeof v === 'string' && (TASK_PRIORITIES as readonly string[]).includes(v) ? (v as TaskPriority) : '';
}

export const TASK_LINK_KINDS = ['lines_chat', 'lines_message', 'chat_conversation', 'docs_page', 'track_issue'] as const;
export type TaskLinkKind = (typeof TASK_LINK_KINDS)[number];

/** Vínculos que se pueden agregar desde la API (Track se vincula al pasar la tarea a Track). */
export const API_LINK_KINDS = ['lines_chat', 'lines_message', 'chat_conversation', 'docs_page'] as const satisfies readonly TaskLinkKind[];

export function isTaskLinkKind(v: unknown): v is TaskLinkKind {
  return typeof v === 'string' && (TASK_LINK_KINDS as readonly string[]).includes(v);
}

/** App dueña del registro vinculado (para mostrarlo y para chequear acceso). */
export const LINK_APP: Record<TaskLinkKind, 'groups' | 'chat' | 'docs' | 'track'> = {
  lines_chat: 'groups',
  lines_message: 'groups',
  chat_conversation: 'chat',
  docs_page: 'docs',
  track_issue: 'track',
};

export interface TaskLink {
  kind: TaskLinkKind;
  refId: string;
  /** Nombre del registro (chat, página, issue); '' si ya no existe. */
  label: string;
  /** Texto corto extra: el mensaje de WhatsApp, el título del issue. */
  detail: string;
  href: string;
  app: (typeof LINK_APP)[TaskLinkKind];
  /** El registro ya no está (se borró): el vínculo queda pero sin link. */
  missing: boolean;
  /** Chat de Groups del vínculo (chat o mensaje), para el acceso por chat. */
  chatId?: string;
}

/**
 * El origen que se muestra en las listas: el chat de WhatsApp (con el mensaje
 * si salió de uno), la conversación de Chat, la página de Docs o el issue.
 */
export function primaryLink(links: TaskLink[] | undefined): TaskLink | null {
  if (!links?.length) return null;
  const live = links.filter((l) => !l.missing);
  const order: TaskLinkKind[] = ['lines_message', 'lines_chat', 'chat_conversation', 'docs_page', 'track_issue'];
  for (const k of order) {
    const hit = live.find((l) => l.kind === k);
    if (hit) return hit;
  }
  return null;
}

/** Quita lo que la persona no puede abrir (app sin acceso): sin nombre ni link. */
export function visibleLinks(links: TaskLink[], canUse: (app: TaskLink['app']) => boolean): TaskLink[] {
  return links.map((l) => (canUse(l.app) ? l : { ...l, label: '', detail: '', href: '' }));
}

