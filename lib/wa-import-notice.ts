/**
 * El aviso de importación arriba de la lista de chats, igual en Lines y en
 * Inbox: qué decir según en qué anda la importación de verdad.
 *
 * Antes el aviso solo sabía "corre" o "terminó". Con todos los chats ya
 * contados (20 de 20) la importación seguía trabajando en otra cosa (fotos de
 * perfil, miembros de los grupos, historial viejo) o esperando a una línea
 * desconectada, y el aviso mostraba "Importando mensajes: 20 de 20 chats" con
 * la barra llena, sin forma de cerrarlo. Acá cada caso tiene su nombre, y
 * todos se pueden cerrar.
 *
 * Sin dependencias del servidor: lo usan los componentes y los tests.
 */

export type ImportNoticeKind =
  /** Buscando los chats: todavía no hay total. */
  | 'counting'
  /** Trayendo mensajes chat por chat: el único caso con barra. */
  | 'progress'
  /** Los chats ya están; faltan fotos de perfil y miembros de los grupos. */
  | 'finishing'
  /** Los chats ya están; sigue el historial viejo en segundo plano. */
  | 'older'
  /** WhatsApp todavía está mandando el historial de la vinculación. */
  | 'waiting'
  /** Frenada porque la línea o la cuenta está desconectada: sigue al reconectar. */
  | 'paused'
  /** Sin avance hace rato o con el servidor de WhatsApp sin responder: reintenta sola. */
  | 'stalled'
  /** Se cortó: hay que volver a empezarla. */
  | 'failed'
  | 'done'
  /** Terminó sin nada nuevo que traer. */
  | 'nothingNew';

export interface ImportNotice {
  /** Para React: una importación, un aviso. */
  id: string;
  /**
   * Clave del cierre: la importación y si el aviso es un problema o no. Cerrar
   * el avance también cierra el "terminó" de esa importación, pero no un error
   * que aparezca después. Otra importación tiene otra clave y avisa de nuevo.
   */
  key: string;
  kind: ImportNoticeKind;
  tone: 'info' | 'done' | 'bad';
  source: 'whatsapp' | 'gmail';
  done: number;
  total: number;
  messages: number;
  /** Porcentaje de la barra; null cuando no hay nada que medir (no se dibuja una barra llena que no dice nada). */
  percent: number | null;
}

/** Cuánto queda a la vista "terminó" antes de irse solo. */
export const DONE_VISIBLE_MS = 8_000;
/** Sin ningún avance guardado en este tiempo, una importación en curso se considera trabada. */
export const IMPORT_IDLE_MS = 10 * 60_000;

const PROBLEM = new Set<ImportNoticeKind>(['paused', 'stalled', 'failed']);

function notice(identity: string, kind: ImportNoticeKind, source: ImportNotice['source'], n: { done: number; total: number; messages: number }): ImportNotice {
  const total = Math.max(n.total, n.done, 0);
  const done = Math.max(n.done, 0);
  return {
    id: identity,
    key: `${identity}:${PROBLEM.has(kind) ? 'problem' : 'ok'}`,
    kind,
    tone: kind === 'failed' || kind === 'stalled' || kind === 'paused' ? 'bad' : kind === 'done' || kind === 'nothingNew' ? 'done' : 'info',
    source,
    done,
    total,
    messages: Math.max(n.messages, 0),
    percent: kind === 'progress' && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null,
  };
}

/** Lo que el aviso necesita de una importación de Lines (lib/groups-import.ts, ImportStatus). */
export interface LinesImportLike {
  numberId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  phase: 'groups' | 'chats' | 'contacts' | 'messages' | 'pictures' | 'older' | 'done';
  chatsTotal: number;
  chatsDone: number;
  messages: number;
  error: string;
  startedAt: string;
  /** El servidor no guardó ningún avance en IMPORT_IDLE_MS. */
  idle?: boolean;
}

export function linesImportNotice(im: LinesImportLike): ImportNotice {
  // started_at es la generación: "Reimportar" la cambia y el aviso vuelve aunque el anterior se haya cerrado.
  const identity = `${im.numberId}:${im.startedAt}`;
  const n = { done: im.chatsDone, total: im.chatsTotal, messages: im.messages };
  const kind = ((): ImportNoticeKind => {
    if (im.status === 'done') return im.messages === 0 ? 'nothingNew' : 'done';
    if (im.status === 'error') return 'failed';
    if (im.error === 'not_connected') return 'paused';
    if (im.error || im.idle) return 'stalled';
    if (im.phase === 'older') return 'older';
    // Con todos los chats contados ya no se "importan mensajes": lo que sigue son fotos y miembros.
    if (im.phase === 'pictures') return 'finishing';
    if (im.phase === 'messages') return im.chatsTotal > 0 && im.chatsDone >= im.chatsTotal ? 'finishing' : 'progress';
    return 'counting';
  })();
  return notice(identity, kind, 'whatsapp', n);
}

/** Lo que el aviso necesita de una importación de Inbox (lib/inbox/import-jobs.ts, ImportJobDto). */
export interface InboxImportLike {
  id: string;
  kind: string;
  status: string;
  progress: { chats?: number; chatsDone?: number; messages?: number };
  error: string;
  finishedAt: string | null;
  idle?: boolean;
}

/** Cuánto se sigue avisando de una importación de Inbox que terminó o se cortó sin que nadie la cierre. */
const INBOX_FRESH_MS = 86_400_000;

/** null: esa importación no va en el aviso (un archivo, una pausada a mano, una cancelada o una vieja). */
export function inboxImportNotice(job: InboxImportLike, now: number): ImportNotice | null {
  if (job.kind !== 'whatsapp' && job.kind !== 'gmail') return null;
  const n = { done: job.progress.chatsDone ?? 0, total: job.progress.chats ?? 0, messages: job.progress.messages ?? 0 };
  const fresh = !!job.finishedAt && now - Date.parse(job.finishedAt) < INBOX_FRESH_MS;
  const kind = ((): ImportNoticeKind | null => {
    if (job.status === 'done') return fresh ? 'done' : null;
    if (job.status === 'failed') return fresh ? 'failed' : null;
    if (job.status !== 'running' && job.status !== 'waiting') return null;
    if (job.error === 'not_connected' || job.error === 'gmail_reconnect') return 'paused';
    if (job.error === 'history_syncing') return 'waiting';
    if (job.error || job.idle) return 'stalled';
    if (job.status === 'waiting' && !n.total) return 'waiting';
    if (!n.total) return 'counting';
    return 'progress';
  })();
  return kind ? notice(job.id, kind, job.kind, n) : null;
}

/** ¿Hay algo corriendo? (para decidir cada cuánto volver a preguntar). */
export function importNoticeBusy(n: ImportNotice): boolean {
  return n.tone !== 'done' && n.kind !== 'failed';
}
