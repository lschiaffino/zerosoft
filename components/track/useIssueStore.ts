'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TrackStatusRow } from '@/lib/db';
import type { ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import { applyIssuePatch, findOpenStatus, toggleDoneStatus, type IssuePatch, type IssuePriority } from '@/lib/track-tasks';

/** Lo que una vista necesita saber de un proyecto para editar inline. */
export interface ProjectContext {
  id: string;
  name: string;
  icon?: string | null;
  statuses: TrackStatusRow[];
  members: ProjectMember[];
}

export type ProjectMap = Record<string, ProjectContext>;

export interface IssueDraft {
  title: string;
  description?: string;
  statusId?: string | null;
  priority?: IssuePriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}

export interface IssueStore {
  issues: TrackIssueWithStatus[];
  setIssues: Dispatch<SetStateAction<TrackIssueWithStatus[]>>;
  update: (issueId: string, patch: IssuePatch) => Promise<void>;
  toggleDone: (issue: TrackIssueWithStatus) => Promise<void>;
  create: (projectId: string, draft: IssueDraft) => Promise<TrackIssueWithStatus | null>;
  error: string | null;
  clearError: () => void;
}

export function isPendingIssue(issue: Pick<TrackIssueWithStatus, 'id'>): boolean {
  return issue.id.startsWith('tmp-');
}

interface Messages {
  saveError: string;
  createError: string;
  noDoneStatus: string;
}

function draftIssue(projectId: string, id: string, draft: IssueDraft, ctx?: ProjectContext): TrackIssueWithStatus {
  const now = new Date().toISOString();
  const statusId = draft.statusId ?? (ctx ? findOpenStatus(ctx.statuses)?.id : undefined) ?? null;
  const base: TrackIssueWithStatus = {
    id,
    project_id: projectId,
    identifier: '…',
    title: draft.title.trim(),
    description: '[]',
    status_id: null,
    priority: draft.priority ?? 'medium',
    assignee_id: null,
    creator_id: '',
    cycle_id: null,
    estimate: null,
    parent_id: null,
    start_date: null,
    due_date: null,
    labels: '[]',
    created_at: now,
    updated_at: now,
    status_name: null,
    status_color: null,
    status_category: null,
    assignee_name: null,
    assignee_email: null,
    cycle_name: null,
    child_count: 0,
  };
  return applyIssuePatch(
    base,
    { statusId, assigneeId: draft.assigneeId ?? null, dueDate: draft.dueDate ?? null },
    ctx?.statuses,
    ctx?.members,
  );
}

/**
 * Estado de una lista de issues con mutaciones optimistas: cada cambio se
 * aplica al instante, se confirma con la respuesta del server y se revierte
 * (con un mensaje) si la API falla.
 */
export function useIssueStore(
  initial: TrackIssueWithStatus[],
  projects: ProjectMap,
  messages: Messages,
): IssueStore {
  const [issues, setIssues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const issuesRef = useRef(issues);
  issuesRef.current = issues;
  const createQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const replace = useCallback((id: string, fn: (i: TrackIssueWithStatus) => TrackIssueWithStatus) => {
    setIssues((list) => list.map((i) => (i.id === id ? fn(i) : i)));
  }, []);

  const update = useCallback(
    async (issueId: string, patch: IssuePatch) => {
      const prev = issuesRef.current.find((i) => i.id === issueId);
      if (!prev || isPendingIssue(prev)) return;
      const ctx = projects[prev.project_id];
      replace(issueId, (i) => applyIssuePatch(i, patch, ctx?.statuses, ctx?.members));
      try {
        const res = await fetch(`/api/track/issues/${issueId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`patch ${res.status}`);
        const saved = (await res.json()) as TrackIssueWithStatus;
        replace(issueId, (i) => ({ ...i, ...saved }));
      } catch {
        // Revertir solo los campos de este parche, para no pisar otros
        // cambios optimistas que hayan llegado mientras tanto.
        replace(issueId, (i) => {
          const r = { ...i };
          if (patch.title !== undefined) r.title = prev.title;
          if (patch.priority !== undefined) r.priority = prev.priority;
          if (patch.dueDate !== undefined) r.due_date = prev.due_date;
          if (patch.statusId !== undefined) {
            r.status_id = prev.status_id;
            r.status_name = prev.status_name;
            r.status_color = prev.status_color;
            r.status_category = prev.status_category;
          }
          if (patch.assigneeId !== undefined) {
            r.assignee_id = prev.assignee_id;
            r.assignee_name = prev.assignee_name;
            r.assignee_email = prev.assignee_email;
          }
          return r;
        });
        setError(messages.saveError);
      }
    },
    [projects, replace, messages.saveError],
  );

  const toggleDone = useCallback(
    async (issue: TrackIssueWithStatus) => {
      const ctx = projects[issue.project_id];
      const target = toggleDoneStatus(issue.status_category, ctx?.statuses ?? []);
      if (!target) {
        setError(messages.noDoneStatus);
        return;
      }
      await update(issue.id, { statusId: target.id });
    },
    [projects, update, messages.noDoneStatus],
  );

  const create = useCallback(
    async (projectId: string, draft: IssueDraft) => {
      const ctx = projects[projectId];
      const tempId = `tmp-${Math.random().toString(36).slice(2, 10)}`;
      const temp = draftIssue(projectId, tempId, draft, ctx);
      setIssues((list) => [...list, temp]);
      const run = async (): Promise<TrackIssueWithStatus | null> => {
        try {
          const res = await fetch(`/api/track/projects/${projectId}/issues`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: temp.title,
              description: draft.description?.trim() ? [{ type: 'text', text: draft.description.trim() }] : [],
              statusId: temp.status_id ?? undefined,
              priority: temp.priority,
              assigneeId: draft.assigneeId || undefined,
              dueDate: draft.dueDate || undefined,
            }),
          });
          if (!res.ok) throw new Error(`create ${res.status}`);
          const saved = (await res.json()) as TrackIssueWithStatus;
          setIssues((list) => list.map((i) => (i.id === tempId ? saved : i)));
          return saved;
        } catch {
          setIssues((list) => list.filter((i) => i.id !== tempId));
          setError(messages.createError);
          return null;
        }
      };
      // Las creaciones se mandan en serie: los identificadores (PROJ-n)
      // quedan en el mismo orden en que se tipearon.
      const next = createQueue.current.then(run);
      createQueue.current = next;
      return next;
    },
    [projects, messages.createError],
  );

  const clearError = useCallback(() => setError(null), []);

  return { issues, setIssues, update, toggleDone, create, error, clearError };
}

/**
 * Atajo de teclado "C" para crear un issue. Ignora la tecla si el foco está
 * en un campo editable o si hay modificadores (para no pisar Cmd+C).
 */
export function useCreateShortcut(onCreate: () => void, enabled = true): void {
  const cb = useRef(onCreate);
  cb.current = onCreate;
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          el.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]'))
      ) {
        return;
      }
      e.preventDefault();
      cb.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
