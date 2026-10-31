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
  /** Notes (meta.noteKind): pedidos de acceso, tareas y pases de notas. */
  noteAccessRequest?: string;
  noteTaskAssigned?: string;
  noteTaskDue?: string;
  noteTransfer?: string;
  /** "{actor} cambió lo mismo en {title}: tu versión quedó en el historial". */
  docConflict?: string;
  boardMention: string;
  boardReply: string;
  /** Track, plans: "{actor} publicó un update en {plan}" y similares (opcionales). */
  planUpdate?: string;
  planComment?: string;
  planReminder?: string;
  /** Track triage, SLAs y agentes (meta.kind): "{identifier} espera triage" y similares. */
  trackKinds?: Partial<Record<'triage_owner' | 'sla_risk' | 'sla_breach' | 'agent_update', string>>;
  /** Groups: "{actor} te mencionó en {title}", "{actor} te asignó {title}", "Chat nuevo para vos: {title}". */
  groupsMention?: string;
  groupsAssigned?: string;
  groupsAutoAssigned?: string;
  /** Rec: "{actor} vio {title}", "{actor} comentó en {title}", "{actor} reaccionó {emoji} a {title}". */
  recView?: string;
  recComment?: string;
  /** Avisos agrupados: "{count} comentarios nuevos en {title}". */
  recComments?: string;
  recReaction?: string;
  /** Design: "{actor} comentó en {title}", "{actor} compartió {title} con vos". */
  designComment?: string;
  designShare?: string;
  /** Social: "{title} espera tu aprobación", "Aprobaron {title}", "Rechazaron {title}", "No se pudo publicar {title}"… */
  socialApproval?: string;
  socialApproved?: string;
  socialRejected?: string;
  socialFailed?: string;
  socialPartial?: string;
  socialAssigned?: string;
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

  if (source === 'note' && meta.noteKind) {
    const tpl = { access_request: L.noteAccessRequest, task_assigned: L.noteTaskAssigned, task_due: L.noteTaskDue, transfer: L.noteTransfer }[String(meta.noteKind)];
    if (tpl) return fill(tpl, { actor, title: String(meta.title ?? L.untitled), count: String(meta.count ?? '') });
  }

  if (source === 'track_plan') {
    const vars = { actor, plan: String(meta.planName ?? '') };
    const tpl = meta.kind === 'reminder' ? L.planReminder : meta.kind === 'comment' ? L.planComment : L.planUpdate;
    return tpl && vars.plan ? fill(tpl, vars) : n.title;
  }

  if (source === 'track_triage' || source === 'track_sla' || source === 'track_agent') {
    const identifier = String(meta.issueIdentifier ?? '');
    const tpl = L.trackKinds?.[String(meta.kind) as keyof NonNullable<NotificationTextLabels['trackKinds']>];
    return identifier && tpl ? fill(tpl, { actor, identifier, agent: String(meta.agentName ?? '') }) : n.title;
  }

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
    if (source === 'docs_page' && meta.conflict && L.docConflict) return fill(L.docConflict, vars);
    if (source === 'docs_page' && n.type === 'mention') return fill(L.docMention, vars);
    if (source === 'docs_comment') return fill(meta.reply ? L.docCommentReply : L.docCommentMention, vars);
    return n.title;
  }

  if (source === 'groups_chat' && meta.chatName) {
    const vars = { actor, title: String(meta.chatName) };
    if (n.type === 'mention' && L.groupsMention) return fill(L.groupsMention, vars);
    if (n.type === 'assigned' && meta.rule && L.groupsAutoAssigned) return fill(L.groupsAutoAssigned, vars);
    if (n.type === 'assigned' && L.groupsAssigned) return fill(L.groupsAssigned, vars);
  }

  if (source === 'board_comment' && meta.boardName) {
    const vars = { actor, title: String(meta.boardName) };
    if (n.type === 'mention') return fill(L.boardMention, vars);
    if (n.type === 'comment') return fill(L.boardReply, vars);
  }

  if (source === 'rec_video') {
    const vars = { actor, title: String(meta.title || L.untitled), emoji: String(meta.emoji || ''), count: String(meta.count || '1') };
    if (n.type === 'rec_comment' && Number(meta.count) > 1 && L.recComments) return fill(L.recComments, vars);
    if (n.type === 'rec_view' && L.recView) return fill(L.recView, vars);
    if (n.type === 'rec_comment' && meta.emoji && L.recReaction) return fill(L.recReaction, vars);
    if (n.type === 'rec_comment' && L.recComment) return fill(L.recComment, vars);
  }

  if (source === 'design') {
    const vars = { actor, title: String(meta.title || L.untitled) };
    if (n.type === 'design_comment' && L.designComment) return fill(L.designComment, vars);
    if (n.type === 'design_share' && L.designShare) return fill(L.designShare, vars);
  }

  if (source === 'social_post' || source === 'social_inbox') {
    const vars = { actor, title: String(meta.postText || meta.text || n.title || L.untitled) };
    const key =
      n.type === 'social_approval' ? L.socialApproval
      : n.type === 'social_approved' ? L.socialApproved
      : n.type === 'social_rejected' ? L.socialRejected
      : n.type === 'social_failed' ? (meta.partial ? L.socialPartial : L.socialFailed)
      : n.type === 'social_assigned' ? L.socialAssigned
      : undefined;
    if (key) return fill(key, vars);
  }

  return n.title;
}
