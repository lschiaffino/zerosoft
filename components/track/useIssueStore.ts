'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TrackIssueTemplateRow, TrackStatusRow } from '@/lib/db';
import type { ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import {
  applyIssuePatch,
  defaultIssueStatus,
  inversePatch,
  revertPatchFields,
  toggleDoneStatus,
  type IssuePatch,
  type IssuePriority,
} from '@/lib/track-tasks';
import { pushUndo } from './trackUndo';
import { insertIssueSorted, type IssueSort } from '@/lib/track-views';

/** Lo que una vista necesita saber de un proyecto para editar inline. */
export interface ProjectContext {
  id: string;
  name: string;
  icon?: string | null;
  statuses: TrackStatusRow[];
  members: ProjectMember[];
  /** Ciclos del proyecto (el quick-create preselecciona el activo). */
  cycles?: Array<{ id: string; name: string; start_at: string; end_at: string }>;
  /** Milestones del proyecto (el quick-create deja elegir uno). */
  milestones?: Array<{ id: string; name: string }>;
  /** Plantillas de issue (el quick-create las aplica sobre el borrador). */
  templates?: TrackIssueTemplateRow[];
  /** Labels del workspace (nombres y colores para el cambio optimista). */
  labels?: Array<{ id: string; name: string; color: string }>;
}

export type ProjectMap = Record<string, ProjectContext>;

export interface IssueDraft {
  title: string;
  description?: string;
  statusId?: string | null;
  priority?: IssuePriority;
  assigneeId?: string | null;
  dueDate?: string | null;
  /** Sub-issue: id del issue padre. */
  parentId?: string | null;
  cycleId?: string | null;
  milestoneId?: string | null;
  estimate?: number | null;
  /** Labels del workspace (por id). */
  labels?: Array<{ id: string }>;
  /** Project (track_plans) y fecha de inicio, desde los chips del composer. */
  planId?: string | null;
  startDate?: string | null;
  /** Mandarlo a triage del team (opción "Triage" del composer). */
  triage?: boolean;
}

export interface IssueStore {
  issues: TrackIssueWithStatus[];
  setIssues: Dispatch<SetStateAction<TrackIssueWithStatus[]>>;
  /** Cambio optimista; deja una entrada de ⌘Z salvo `{ undo: false }`. */
  update: (issueId: string, patch: IssuePatch, opts?: UpdateOptions) => Promise<void>;
  /** El mismo cambio (o uno por issue) sobre varios, con un solo ⌘Z. */
  updateMany: (
    issueIds: string[],
    patch: IssuePatch | ((issue: TrackIssueWithStatus) => IssuePatch),
    opts?: UpdateOptions,
  ) => Promise<void>;
  toggleDone: (issue: TrackIssueWithStatus) => Promise<void>;
  /** `sort`: orden de la vista, para ubicar el issue nuevo donde va (Newest → arriba). */
  create: (projectId: string, draft: IssueDraft, sort?: IssueSort) => Promise<TrackIssueWithStatus | null>;
  error: string | null;
  clearError: () => void;
}

export function isPendingIssue(issue: Pick<TrackIssueWithStatus, 'id'>): boolean {
  return issue.id.startsWith('tmp-');
}

export interface UpdateOptions {
  /** false = no deja entrada de deshacer (el propio deshacer, arrastres internos). */
  undo?: boolean;
}

interface Messages {
  saveError: string;
  createError: string;
  /** Texto del toast de deshacer ("ZER-12 actualizado", "3 issues actualizados"). */
  updated?: (what: string, count: number) => string;
  noDoneStatus: string;
}

function draftIssue(projectId: string, id: string, draft: IssueDraft, ctx?: ProjectContext): TrackIssueWithStatus {
  const now = new Date().toISOString();
  const statusId = draft.statusId ?? (ctx ? defaultIssueStatus(ctx.statuses)?.id : undefined) ?? null;
  const base: TrackIssueWithStatus = {
    id,
    project_id: projectId,
    identifier: '…',
    title: draft.title.trim(),
    description: '[]',
    status_id: null,
    priority: draft.priority ?? 'none',
    assignee_id: null,
    creator_id: '',
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
    cycle_id: draft.cycleId ?? null,
    cycle_name: draft.cycleId ? (ctx?.cycles?.find((c) => c.id === draft.cycleId)?.name ?? null) : null,
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
  // PATCH en serie por issue (el server los aplica en el orden de los clics) y
  // solo la respuesta del último pisa la fila: una respuesta vieja no tapa un
  // cambio optimista más nuevo.
  const patchQueues = useRef(new Map<string, Promise<unknown>>());
  const patchSeq = useRef(new Map<string, number>());

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const replace = useCallback((id: string, fn: (i: TrackIssueWithStatus) => TrackIssueWithStatus) => {
    setIssues((list) => list.map((i) => (i.id === id ? fn(i) : i)));
  }, []);

  // Un PATCH optimista. Si el issue ya no está en la lista (deshacer después
  // de que un filtro lo sacó, o desde otra página), se manda igual sin
  // cambio optimista: el sondeo en vivo trae el resultado.
  const patchOne = useCallback(
    async (issueId: string, patch: IssuePatch): Promise<TrackIssueWithStatus | null> => {
      const prev = issuesRef.current.find((i) => i.id === issueId);
      if (prev && isPendingIssue(prev)) return null;
      if (!prev) {
        const res = await fetch(`/api/track/issues/${issueId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).catch(() => null);
        if (!res?.ok) setError(messages.saveError);
        return null;
      }
      const ctx = projects[prev.project_id];
      replace(issueId, (i) => applyIssuePatch(i, patch, ctx?.statuses, ctx?.members, ctx));
      const seq = (patchSeq.current.get(issueId) ?? 0) + 1;
      patchSeq.current.set(issueId, seq);
      const send = async () => {
        const res = await fetch(`/api/track/issues/${issueId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`patch ${res.status}`);
        return (await res.json()) as TrackIssueWithStatus;
      };
      const request = (patchQueues.current.get(issueId) ?? Promise.resolve()).catch(() => undefined).then(send);
      patchQueues.current.set(issueId, request);
      try {
        const saved = await request;
        if (patchSeq.current.get(issueId) === seq) replace(issueId, (i) => ({ ...i, ...saved }));
        return prev;
      } catch {
        // Revertir solo los campos de este parche, para no pisar otros
        // cambios optimistas que hayan llegado mientras tanto.
        replace(issueId, (i) => revertPatchFields(i, prev, patch));
        setError(messages.saveError);
        return null;
      }
    },
    [projects, replace, messages.saveError],
  );

  const updated = messages.updated;
  const updateMany = useCallback(
    async (issueIds: string[], patch: IssuePatch | ((issue: TrackIssueWithStatus) => IssuePatch), opts: UpdateOptions = {}) => {
      const list = issueIds
        .map((id) => issuesRef.current.find((i) => i.id === id))
        .filter((i): i is TrackIssueWithStatus => Boolean(i));
      const results = await Promise.all(
        list.map(async (issue) => {
          const p = typeof patch === 'function' ? patch(issue) : patch;
          const prev = await patchOne(issue.id, p);
          return prev ? { id: issue.id, inverse: inversePatch(prev, p), forward: p } : null;
        }),
      );
      const done = results.filter((r): r is { id: string; inverse: IssuePatch; forward: IssuePatch } => Boolean(r));
      if (opts.undo === false || done.length === 0 || !updated) return;
      const what = done.length === 1 ? (list.find((i) => i.id === done[0].id)?.identifier ?? '') : '';
      pushUndo(
        updated(what, done.length),
        async () => {
          await Promise.all(done.map((d) => patchOne(d.id, d.inverse)));
        },
        async () => {
          await Promise.all(done.map((d) => patchOne(d.id, d.forward)));
        },
        { silent: done.length === 1 },
      );
    },
    [patchOne, updated],
  );

  const update = useCallback(
    (issueId: string, patch: IssuePatch, opts: UpdateOptions = {}) => updateMany([issueId], patch, opts),
    [updateMany],
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
    async (projectId: string, draft: IssueDraft, sort?: IssueSort) => {
      const ctx = projects[projectId];
      const tempId = `tmp-${Math.random().toString(36).slice(2, 10)}`;
      const temp = draftIssue(projectId, tempId, draft, ctx);
      setIssues((list) => (sort ? insertIssueSorted(list, temp, sort) : [...list, temp]));
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
              parentId: draft.parentId || undefined,
              cycleId: draft.cycleId || undefined,
              milestoneId: draft.milestoneId || undefined,
              estimate: draft.estimate ?? undefined,
              labels: draft.labels?.length ? draft.labels : undefined,
              planId: draft.planId || undefined,
              startDate: draft.startDate || undefined,
              triage: draft.triage || undefined,
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

  return { issues, setIssues, update, updateMany, toggleDone, create, error, clearError };
}

/**
 * Atajo de teclado "C" para crear un issue. Ignora la tecla si el foco está
 * en un campo editable o si hay modificadores (para no pisar Cmd+C).
 */
/** Evento que abre el quick-create de issues desde fuera (⌘K, botones). */
export const TRACK_NEW_ISSUE_EVENT = 'zs:track-new-issue';

/** Abre el quick-create de Track en contexto (la vista activa decide cuál). */
export function openTrackNewIssue(): void {
  window.dispatchEvent(new CustomEvent(TRACK_NEW_ISSUE_EVENT, { cancelable: true }));
}

export function useCreateShortcut(onCreate: () => void, enabled = true): void {
  const cb = useRef(onCreate);
  cb.current = onCreate;
  useEffect(() => {
    if (!enabled) return;
    // ⌘K → "New issue": la vista lo maneja y el modal global (TrackShortcuts) no.
    const onEvent = (e: Event) => {
      e.preventDefault();
      cb.current();
    };
    window.addEventListener(TRACK_NEW_ISSUE_EVENT, onEvent);
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return;
      // Con Shift es otro atajo (⇧C: cycle), como en Linear.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          el.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"], [role="menu"], [role="listbox"]'))
      ) {
        return;
      }
      e.preventDefault();
      cb.current();
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener(TRACK_NEW_ISSUE_EVENT, onEvent);
    };
  }, [enabled]);
}
