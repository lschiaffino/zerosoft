/**
 * Track — forma pública de los objetos (API v1, servidor MCP, webhooks y
 * Slack). Una sola serialización para que un issue se vea igual por todos
 * los caminos.
 */
import type { TrackCycleRow, TrackProjectRow, TrackStatusRow } from './db';
import type { TrackCommentWithAuthor, TrackIssueWithStatus } from './track-data';
import { parseIssueLabels } from './track-labels';

export function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

export function issueUrl(issueId: string): string {
  return `${appBaseUrl()}/app/track/issues/${issueId}`;
}

export function projectUrl(projectId: string): string {
  return `${appBaseUrl()}/app/track/projects/${projectId}`;
}

/** Descripción guardada (bloques JSON o texto heredado) → texto markdown. */
export function descriptionToText(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map((b: { text?: string }) => b?.text ?? '').join('\n');
  } catch {
    // Texto plano heredado.
  }
  return raw;
}

/** Texto markdown → bloques que guarda el editor (un bloque de texto). */
export function textToDescription(text: string): Array<{ type: 'text'; text: string }> {
  const clean = text.replace(/\r\n/g, '\n').slice(0, 20_000);
  return clean.trim() ? [{ type: 'text', text: clean }] : [];
}

export interface ApiIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  projectId: string;
  status: { id: string; name: string; category: string; color: string | null } | null;
  priority: TrackIssueWithStatus['priority'];
  assignee: { id: string; name: string | null; email: string | null } | null;
  creatorId: string;
  cycle: { id: string; name: string | null } | null;
  milestoneId: string | null;
  parentId: string | null;
  estimate: number | null;
  labels: Array<{ id: string; name: string; color: string }>;
  startDate: string | null;
  dueDate: string | null;
  triage: boolean;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toApiIssue(i: TrackIssueWithStatus): ApiIssue {
  return {
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    description: descriptionToText(i.description),
    url: issueUrl(i.id),
    projectId: i.project_id,
    status: i.status_id
      ? { id: i.status_id, name: i.status_name ?? '', category: i.status_category ?? 'todo', color: i.status_color }
      : null,
    priority: i.priority,
    assignee: i.assignee_id ? { id: i.assignee_id, name: i.assignee_name, email: i.assignee_email } : null,
    creatorId: i.creator_id,
    cycle: i.cycle_id ? { id: i.cycle_id, name: i.cycle_name } : null,
    milestoneId: i.milestone_id ?? null,
    parentId: i.parent_id,
    estimate: i.estimate,
    labels: parseIssueLabels(i.labels).map((l) => ({ id: l.id, name: l.name, color: l.color })),
    startDate: i.start_date,
    dueDate: i.due_date,
    triage: i.triage === 1,
    source: i.source ?? null,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  };
}

export interface ApiProject {
  id: string;
  name: string;
  key: string;
  description: string;
  icon: string | null;
  color: string;
  status: TrackProjectRow['status'];
  visibility: 'workspace' | 'private';
  triageEnabled: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export function toApiProject(p: TrackProjectRow): ApiProject {
  return {
    id: p.id,
    name: p.name,
    key: p.slug.toUpperCase(),
    description: p.description,
    icon: p.icon,
    color: p.color,
    status: p.status,
    visibility: p.visibility === 'private' ? 'private' : 'workspace',
    triageEnabled: p.triage_enabled === 1,
    url: projectUrl(p.id),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export function toApiStatus(s: TrackStatusRow) {
  return { id: s.id, projectId: s.project_id, name: s.name, category: s.category, color: s.color, position: s.position };
}

export function toApiCycle(c: TrackCycleRow) {
  return {
    id: c.id,
    projectId: c.project_id,
    name: c.name,
    startAt: c.start_at,
    endAt: c.end_at,
    completedAt: (c as { completed_at?: string | null }).completed_at ?? null,
  };
}

export function toApiComment(c: TrackCommentWithAuthor) {
  return {
    id: c.id,
    issueId: c.issue_id,
    body: c.body,
    author: { id: c.user_id, name: c.user_name, email: c.user_email },
    createdAt: c.created_at,
    updatedAt: (c as { updated_at?: string | null }).updated_at ?? c.created_at,
  };
}
