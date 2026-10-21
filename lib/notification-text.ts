/**
 * Título de un aviso en el idioma de quien lo lee. Los avisos se guardan con
 * un título de respaldo (en inglés) más `meta`; al mostrarlos se arma el texto
 * con las plantillas del idioma de la UI. Si el aviso no tiene una plantilla
 * conocida, se usa el título guardado.
 */

export interface NotificationTextLabels {
  someone: string;
  untitled: string;
  /** Track: "{actor} te mencionó en {identifier}" y similares. */
  mentionedYou: string;
  assignedYou: string;
  commentedOn: string;
  changedStatus: string;
  updatedIssue: string;
  /** "Recordatorio de {identifier}". */
  reminderFor: string;
  /** Docs y Board: "{actor} te mencionó en {title}" y similares. */
  docMention: string;
  docCommentMention: string;
  docCommentReply: string;
  docShared: string;
  boardMention: string;
  boardReply: string;
}

export interface NotificationLike {
  type: string;
  title: string;
  meta?: string | Record<string, unknown> | null;
  source_type?: string | null;
}

export function parseNotificationMeta(meta: NotificationLike['meta']): Record<string, string> {
  if (!meta) return {};
  if (typeof meta === 'object') return meta as Record<string, string>;
  try {
    const parsed = JSON.parse(meta);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export function notificationTitle(n: NotificationLike, L: NotificationTextLabels): string {
  const meta = parseNotificationMeta(n.meta);
  const actor = String(meta.actorName || L.someone);
  const source = n.source_type ?? '';

  if (source === 'track_issue' || n.type === 'track_reminder') {
    const identifier = String(meta.issueIdentifier ?? '');
    if (!identifier) return n.title;
    const vars = { actor, identifier };
    switch (n.type) {
      case 'mention':
        return fill(L.mentionedYou, vars);
      case 'assigned':
        return fill(L.assignedYou, vars);
      case 'comment':
        return fill(L.commentedOn, vars);
      case 'status_change':
        return fill(L.changedStatus, vars);
      case 'issue_update':
        return fill(L.updatedIssue, vars);
      case 'track_reminder':
        return fill(L.reminderFor, vars);
      default:
        return n.title;
    }
  }

  if (source === 'docs_page' || source === 'docs_comment') {
    const title = String(meta.pageTitle || L.untitled);
    const vars = { actor, title };
    if (source === 'docs_page' && meta.shared) return fill(L.docShared, vars);
    if (source === 'docs_page' && n.type === 'mention') return fill(L.docMention, vars);
    if (source === 'docs_comment') return fill(meta.reply ? L.docCommentReply : L.docCommentMention, vars);
    return n.title;
  }

  if (source === 'board_comment' && meta.boardName) {
    const vars = { actor, title: String(meta.boardName) };
    if (n.type === 'mention') return fill(L.boardMention, vars);
    if (n.type === 'comment') return fill(L.boardReply, vars);
  }

  return n.title;
}
