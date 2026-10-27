/**
 * Chat → Track: crear un issue desde una conversación o vincularla a uno que
 * ya existe (como los tracker tickets de Intercom o su integración con
 * Linear). Cada vínculo es un pedido de cliente del issue (track_customer_requests,
 * source 'chat', con el link a la conversación), así Track cuenta cuántos
 * clientes lo piden y la conversación muestra el issue con su estado. Varias
 * conversaciones pueden colgar del mismo issue. Server-only.
 */
import { getDb } from './db';
import type { ChatConversationRow } from './db';
import { canAccessTrackProject, createIssue, getProject } from './track-data';
import { projectWorkspaceId } from './track-labels';
import { createCustomerRequest } from './track-customers';
import { createChatMessage, getChatVisitor, listChatMessages } from './chat-data';

export interface LinkedIssue {
  requestId: string;
  issueId: string;
  identifier: string;
  title: string;
  statusName: string | null;
  statusCategory: string | null;
}

export class ChatTrackError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

export function conversationHref(conversationId: string): string {
  return `/app/chat/inbox/${conversationId}`;
}

export async function linkedIssues(conversationId: string): Promise<LinkedIssue[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT r.id AS request_id, i.id AS issue_id, i.identifier, i.title, s.name AS status_name, s.category AS status_category
       FROM track_customer_requests r
       JOIN track_issues i ON i.id = r.issue_id
       LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE r.source = 'chat' AND r.source_url = ?
       ORDER BY r.created_at DESC`,
    )
    .all(conversationHref(conversationId))) as Array<{
    request_id: string;
    issue_id: string;
    identifier: string;
    title: string;
    status_name: string | null;
    status_category: string | null;
  }>;
  return rows.map((r) => ({
    requestId: r.request_id,
    issueId: r.issue_id,
    identifier: r.identifier,
    title: r.title,
    statusName: r.status_name,
    statusCategory: r.status_category,
  }));
}

async function attachRequest(
  conversation: ChatConversationRow,
  issue: { id: string; identifier: string; title: string },
  project: { team_id: string | null; owner_id: string | null },
  personId: string,
): Promise<void> {
  const ws = projectWorkspaceId(project);
  if (!ws) throw new ChatTrackError('project_not_found', 404);
  const already = await getDb()
    .prepare("SELECT 1 FROM track_customer_requests WHERE issue_id = ? AND source = 'chat' AND source_url = ?")
    .get(issue.id, conversationHref(conversation.id));
  if (already) throw new ChatTrackError('already_linked');
  const visitor = await getChatVisitor(conversation.visitor_id);
  const lastVisitor = (await listChatMessages(conversation.id)).filter((m) => m.sender_type === 'visitor').pop();
  await createCustomerRequest(
    ws,
    issue.id,
    {
      customerName: visitor?.name || (visitor?.email ? '' : 'Chat visitor'),
      customerEmail: visitor?.email ?? '',
      body: (lastVisitor?.body ?? conversation.subject ?? '').slice(0, 2000),
      source: 'chat',
      sourceUrl: conversationHref(conversation.id),
    },
    personId,
  );
  // Nota de sistema en el hilo (el visitante no la ve).
  await createChatMessage(conversation.id, 'system', { body: `Track: ${issue.identifier} ${issue.title}` });
}

export async function createIssueFromConversation(args: {
  conversation: ChatConversationRow;
  projectId: string;
  title: string;
  teamId: string | null;
  ownerId: string;
  personId: string;
}): Promise<LinkedIssue> {
  const title = args.title.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!title) throw new ChatTrackError('missing_title');
  const project = await getProject(args.projectId);
  if (!project || !(await canAccessTrackProject(project, args.teamId, args.ownerId))) throw new ChatTrackError('project_not_found', 404);
  const messages = (await listChatMessages(args.conversation.id)).filter((m) => m.sender_type === 'visitor' || m.sender_type === 'user').slice(-6);
  const excerpt = messages.map((m) => `${m.sender_type === 'visitor' ? 'Customer' : 'Team'}: ${m.body.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  const issue = await createIssue(
    project.id,
    args.personId,
    { title, description: [{ type: 'text', text: `From a Chat conversation: ${conversationHref(args.conversation.id)}\n\n${excerpt}`.slice(0, 4500) }] },
    { source: 'app' },
  );
  await attachRequest(args.conversation, issue, project, args.personId);
  return (await linkedIssues(args.conversation.id)).find((l) => l.issueId === issue.id)!;
}

/** Vincula la conversación a un issue existente por su identificador (WEB-12). */
export async function linkConversationToIssue(args: {
  conversation: ChatConversationRow;
  identifier: string;
  teamId: string | null;
  ownerId: string;
  personId: string;
}): Promise<LinkedIssue> {
  const ident = args.identifier.trim().toUpperCase().slice(0, 40);
  if (!/^[A-Z0-9]+-\d+$/.test(ident)) throw new ChatTrackError('invalid_identifier');
  const candidates = (await getDb()
    .prepare('SELECT id, project_id, identifier, title FROM track_issues WHERE UPPER(identifier) = ? LIMIT 20')
    .all(ident)) as Array<{ id: string; project_id: string; identifier: string; title: string }>;
  for (const c of candidates) {
    const project = await getProject(c.project_id);
    if (!project || !(await canAccessTrackProject(project, args.teamId, args.ownerId))) continue;
    await attachRequest(args.conversation, c, project, args.personId);
    return (await linkedIssues(args.conversation.id)).find((l) => l.issueId === c.id)!;
  }
  throw new ChatTrackError('issue_not_found', 404);
}

/** Saca el vínculo (el pedido de cliente) sin tocar el issue. */
export async function unlinkIssue(conversationId: string, requestId: string): Promise<boolean> {
  return (
    (await getDb()
      .prepare("DELETE FROM track_customer_requests WHERE id = ? AND source = 'chat' AND source_url = ?")
      .run(requestId, conversationHref(conversationId))).changes > 0
  );
}
