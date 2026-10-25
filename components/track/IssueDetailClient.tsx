'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { issueKeyAction, issueKeyHint } from '@/lib/track-keys';
import { formatDate, relDate } from '@/lib/utils';
import type { CommandAction } from '@/lib/cmdk-context';
import { openCommandMenu } from '@/lib/cmdk-context';
import IssueActivityTimeline from './IssueActivityTimeline';
import { IssueGithubPanel, useIssueGithub } from './IssueGithub';
import { IssueLinksPanel } from './IssueLinks';
import { Popover, TrackToast, useToday } from './InlineEditors';
import { branchNameFor } from '@/lib/track-branch';
import { TriageBanner } from './TriagePanel';
import { IssueMainExtras, IssueSideExtras } from './triage/IssueExtras';
import MarkdownEditor, { MarkdownView, type UploadResult } from './MarkdownEditor';
import TrackIcon from './TrackIcon';
import IssueSubscription from './IssueSubscription';
import IssueReminder from './IssueReminder';
import IssueSidebar from './IssueSidebar';
import SubIssues from './SubIssues';
import { useWorkspaceLabels } from './LabelPicker';
import { applyIssuePatch, findDoneStatus, findOpenStatus, formatDay, inversePatch, type IssuePatch } from '@/lib/track-tasks';
import { toggleTaskInSource } from '@/lib/track-markdown';
import { useIssueStore, type ProjectContext } from './useIssueStore';
import { rowTargetId, useTrackCommands } from './trackCommands';
import { pushNotice, pushUndo, scheduleDelete } from './trackUndo';
import { useTrackLive } from './useTrackLive';
import type { TrackUiLabels } from './ui-labels';
import type { TrackCycleRow, TrackStatusRow } from '@/lib/db';
import type { CommentReaction } from '@/lib/track-ux';
import type {
  IssueParentSummary,
  ProjectMember,
  TrackIssueAttachmentWithAuthor,
  TrackIssueActivityWithAuthor,
  TrackIssueRelationWithTarget,
  TrackIssueWithStatus,
} from '@/lib/track-data';

interface DetailLabels {
  back: string;
  properties: {
    status: string;
    priority: string;
    assignee: string;
    cycle: string;
    estimate: string;
    dueDate: string;
    labels: string;
    noAssignee: string;
    none: string;
    title: string;
    estimatePlaceholder: string;
    estimateUnit: string;
  };
  priorities: Array<{ value: string; label: string }>;
  subtasks: {
    title: string;
    add: string;
    empty: string;
    hasSubtasks: string;
  };
  attachments: {
    title: string;
    upload: string;
    drop: string;
    empty: string;
    delete: string;
    size: string;
    tooLarge: string;
    typeNotAllowed: string;
    uploadError: string;
  };
  activity: {
    title: string;
    created: string;
    statusChange: string;
    assigneeChange: string;
    priorityChange: string;
    cycleChange: string;
    dueDateChange: string;
    estimateChange: string;
    titleChange: string;
    descriptionChange: string;
    relationAdded: string;
    relationRemoved: string;
    attachmentAdded: string;
    subtaskAdded: string;
    closed: string;
    reopened: string;
    commented: string;
    from: string;
    to: string;
    unassigned: string;
    addComment: string;
    submitComment: string;
    empty: string;
    editComment: string;
    deleteComment: string;
    deleteCommentConfirm: string;
    saveComment: string;
    cancelEdit: string;
    edited: string;
  };
  relations: {
    title: string;
    outgoing: string;
    incoming: string;
    blocks: string;
    blockedBy: string;
    related: string;
    duplicates: string;
    duplicatedBy: string;
    add: string;
    remove: string;
    empty: string;
    selectIssue: string;
    selectType: string;
    notFound: string;
    duplicate: string;
    self: string;
    error: string;
    cancel: string;
  };
  actions: {
    close: string;
    reopen: string;
  };
  description: string;
  untitled: string;
  createdOn: string;
  edit: {
    title: string;
    descriptionPlaceholder: string;
    more: string;
    copyBranch: string;
    copied: string;
    addSubtask: string;
    addAttachment: string;
    addRelation: string;
    editDescription: string;
  };
  subscription: {
    subscribe: string;
    unsubscribe: string;
    subscribed: string;
    notSubscribed: string;
    error: string;
  };
}

interface IssueDetailClientProps {
  locale: string;
  userId: string;
  initialIssue: TrackIssueWithStatus;
  initialProjectName: string;
  initialStatuses: TrackStatusRow[];
  initialCycles: TrackCycleRow[];
  initialMilestones?: Array<{ id: string; name: string }>;
  /** Recordatorio de la persona para este issue. */
  initialReminder?: { remindAt: string; sentAt: string | null } | null;
  initialMembers: ProjectMember[];
  initialChildren: TrackIssueWithStatus[];
  initialParentChain: IssueParentSummary[];
  initialAttachments: TrackIssueAttachmentWithAuthor[];
  initialActivities: TrackIssueActivityWithAuthor[];
  initialRelations: TrackIssueRelationWithTarget[];
  initialReactions?: CommentReaction[];
  /** Si la persona recibe los avisos del issue. */
  initialSubscribed: boolean;
  labels: DetailLabels;
  /** Labels del quick-create y de la edición en línea. */
  ui: TrackUiLabels;
  /** Borrar es solo para owner/admin (igual que el borrado masivo). */
  canDelete?: boolean;
}

function parseDescription(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((b: { text?: string }) => b.text ?? '').join('\n');
    return raw;
  } catch {
    return raw;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Textarea que crece con el contenido (título y descripción editables en línea). */
function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}

const RELATION_TYPES = ['blocks', 'related', 'duplicates'] as const;

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return Boolean(node && (node.isContentEditable || node.closest?.('input, textarea, select, dialog, [role="dialog"]')));
}

/**
 * Página del issue al estilo Linear: breadcrumb proyecto › padre › issue,
 * título grande editable, descripción con el editor, sub-issues con progreso,
 * línea de tiempo densa con hilos y reacciones, y el panel de propiedades a
 * la derecha. Todo se maneja con el teclado (S, P, A, L, ⌘K, ⌘⇧O, ⌘Z) y se
 * actualiza en vivo con los cambios de otros.
 */
export default function IssueDetailClient({
  locale,
  userId,
  initialIssue,
  initialProjectName,
  initialStatuses,
  initialCycles,
  initialMilestones = [],
  initialReminder,
  initialMembers,
  initialChildren,
  initialParentChain,
  initialAttachments,
  initialActivities,
  initialRelations,
  initialReactions = [],
  initialSubscribed,
  labels,
  ui,
  canDelete = false,
}: IssueDetailClientProps) {
  const t = useTranslations('track');
  const tx = useTranslations('track.ux');
  const tc = useTranslations('track.ux.cmd');
  const router = useRouter();
  const today = useToday();
  const [issue, setIssue] = useState(initialIssue);
  const issueRef = useRef(issue);
  issueRef.current = issue;
  const github = useIssueGithub(issue.id);
  const [attachments, setAttachments] = useState(initialAttachments);
  const [activities, setActivities] = useState(initialActivities);
  const [reactions, setReactions] = useState(initialReactions);
  const [relations, setRelations] = useState(initialRelations);
  const [parentChain, setParentChain] = useState(initialParentChain);
  const [uploading, setUploading] = useState(false);
  const [showRelationForm, setShowRelationForm] = useState(false);
  const [relationInput, setRelationInput] = useState('');
  const [relationType, setRelationType] = useState<(typeof RELATION_TYPES)[number]>('related');
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(initialIssue.title);
  const [descDraft, setDescDraft] = useState(() => parseDescription(initialIssue.description));
  const [editingDesc, setEditingDesc] = useState(false);
  const [composerSignal, setComposerSignal] = useState(0);
  // Aviso para lectores de pantalla tras copiar (rama o link).
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mac, setMac] = useState(true);
  const [workspaceLabels] = useWorkspaceLabels();
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  const titleRef = useAutosize(titleDraft);
  const descRef = useAutosize(editingDesc ? descDraft : '');
  const titleFocused = useRef(false);

  // ?sub=1 (⌘⇧O desde una lista): abre el composer de sub-issues.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('sub') !== '1') return;
    setComposerSignal((n) => n + 1);
    sp.delete('sub');
    const qs = sp.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, []);

  const project = useMemo<ProjectContext>(
    () => ({
      id: issue.project_id,
      name: initialProjectName,
      statuses: initialStatuses,
      members: initialMembers,
      cycles: initialCycles,
      milestones: initialMilestones,
      labels: workspaceLabels,
    }),
    [issue.project_id, initialProjectName, initialStatuses, initialMembers, initialCycles, initialMilestones, workspaceLabels],
  );
  const projectMap = useMemo(() => ({ [project.id]: project }), [project]);
  const updatedLabel = useCallback(
    (what: string, count: number) => (count === 1 ? tx('undo.updatedOne', { id: what }) : tx('undo.updatedMany', { count })),
    [tx],
  );
  const childStore = useIssueStore(initialChildren, projectMap, {
    saveError: ui.inline.saveError,
    createError: ui.inline.createError,
    noDoneStatus: ui.inline.noDoneStatus,
    updated: updatedLabel,
  });
  const setChildren = childStore.setIssues;

  // ---------- Recargas (también las dispara el sondeo en vivo) ----------

  const refreshIssue = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issue.id}`).catch(() => null);
    if (!res?.ok) return;
    const next = (await res.json()) as TrackIssueWithStatus;
    setIssue(next);
    // El título y la descripción solo se pisan si no se están editando.
    if (!titleFocused.current) setTitleDraft(next.title);
    if (!descOpen.current) setDescDraft(parseDescription(next.description));
  }, [issue.id]);

  const refreshChildren = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issue.id}/children`).catch(() => null);
    if (res?.ok) setChildren(((await res.json()) as { rows: TrackIssueWithStatus[] }).rows);
  }, [issue.id, setChildren]);

  const refreshAttachments = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issue.id}/attachments`).catch(() => null);
    if (res?.ok) setAttachments(((await res.json()) as { rows: TrackIssueAttachmentWithAuthor[] }).rows);
  }, [issue.id]);

  const refreshActivities = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issue.id}/activities`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { rows: TrackIssueActivityWithAuthor[]; reactions?: CommentReaction[] };
    setActivities(data.rows);
    if (data.reactions) setReactions(data.reactions);
  }, [issue.id]);

  const refreshRelations = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issue.id}/relations`).catch(() => null);
    if (res?.ok) setRelations(((await res.json()) as { rows: TrackIssueRelationWithTarget[] }).rows);
  }, [issue.id]);

  const handleIssueChange = useCallback(async () => {
    await Promise.all([refreshIssue(), refreshActivities()]);
  }, [refreshIssue, refreshActivities]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshIssue(), refreshActivities(), refreshChildren(), refreshRelations(), refreshAttachments()]);
  }, [refreshIssue, refreshActivities, refreshChildren, refreshRelations, refreshAttachments]);

  const { viewers } = useTrackLive({ issueId: issue.id }, () => void refreshAll(), { syncOnStart: true });

  // ---------- Cambios del issue (optimistas, con ⌘Z) ----------

  const patchIssue = useCallback(
    async (patch: IssuePatch, opts: { undo?: boolean } = {}) => {
      const prev = issueRef.current;
      setIssue((cur) => applyIssuePatch(cur, patch, initialStatuses, initialMembers, project));
      const res = await fetch(`/api/track/issues/${prev.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch(() => null);
      if (!res?.ok) {
        setIssue(prev);
        setSaveError(ui.inline.saveError);
        return false;
      }
      setIssue((await res.json()) as TrackIssueWithStatus);
      void refreshActivities();
      if (patch.parentId !== undefined) router.refresh();
      if (opts.undo !== false) {
        const inverse = inversePatch(prev, patch);
        pushUndo(tx('undo.updatedOne', { id: prev.identifier }), async () => {
          await patchIssueRef.current(inverse, { undo: false });
        });
      }
      return true;
    },
    [initialStatuses, initialMembers, project, ui.inline.saveError, refreshActivities, router, tx],
  );
  const patchIssueRef = useRef(patchIssue);
  patchIssueRef.current = patchIssue;

  async function setLabels(next: Array<{ id: string } | { name: string }>) {
    const prev = issueRef.current;
    const res = await fetch(`/api/track/issues/${prev.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setSaveError(ui.inline.saveError);
      return;
    }
    setIssue((await res.json()) as TrackIssueWithStatus);
    void refreshActivities();
    const inverse = inversePatch(prev, { labels: [] });
    pushUndo(tx('undo.updatedOne', { id: prev.identifier }), async () => {
      await patchIssueRef.current(inverse, { undo: false });
    });
  }

  // Igual que el checkbox de las listas (useIssueStore.toggleDone): cerrar va al
  // primer Done (nunca a Cancelled) y reabrir prefiere Todo.
  const doneStatus = findDoneStatus(initialStatuses);
  const openStatus = findOpenStatus(initialStatuses);
  const isClosed = issue.status_category === 'done' || issue.status_category === 'cancelled';

  function handleCloseReopen() {
    const targetId = isClosed ? openStatus?.id : doneStatus?.id;
    if (targetId) void patchIssue({ statusId: targetId });
  }

  // ---------- Sub-issues ----------

  const createSubIssue = useCallback(
    async (title: string) => {
      const parent = issueRef.current;
      // Como en Linear: heredan prioridad, cycle y milestone; el asignado si
      // quien crea es el asignado del padre.
      const inheritsAssignee = parent.assignee_id && parent.assignee_id === userId;
      await childStore.create(parent.project_id, {
        title,
        parentId: parent.id,
        priority: parent.priority,
        cycleId: parent.cycle_id,
        milestoneId: parent.milestone_id ?? null,
        assigneeId: inheritsAssignee ? parent.assignee_id : null,
      });
      void refreshActivities();
    },
    [childStore, userId, refreshActivities],
  );

  // "Agregar existente": elegir un issue y hacerlo sub-issue de este.
  const addExistingAction = useCallback(
    (): CommandAction => ({
      id: 'add-sub',
      label: tx('sub.addExisting'),
      keywords: 'sub-issue existing existente child hijo',
      placeholder: tc('searchParent'),
      children: () => [],
      load: async (q) => {
        const sp = new URLSearchParams({ pageSize: '12' });
        if (q.trim()) sp.set('q', q.trim());
        const res = await fetch(`/api/track/issues?${sp.toString()}`);
        if (!res.ok) return [];
        const me = issueRef.current;
        const blocked = new Set([me.id, ...parentChain.map((p) => p.id), ...childStore.issues.map((c) => c.id)]);
        return ((await res.json()) as { rows: TrackIssueWithStatus[] }).rows
          .filter((r) => !blocked.has(r.id))
          .map((r) => ({
            id: `add-sub:${r.id}`,
            label: `${r.identifier} ${r.title}`,
            run: async () => {
              const ok = await fetch(`/api/track/issues/${r.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentId: me.id }),
              }).catch(() => null);
              if (!ok?.ok) {
                setSaveError(ui.inline.saveError);
                return;
              }
              await refreshChildren();
              pushUndo(tx('undo.updatedOne', { id: r.identifier }), async () => {
                await fetch(`/api/track/issues/${r.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ parentId: r.parent_id }),
                });
                await refreshChildren();
              });
            },
          }));
      },
    }),
    [tx, tc, parentChain, childStore.issues, refreshChildren, ui.inline.saveError],
  );

  // ---------- Título y descripción ----------

  async function saveTitle() {
    const next = titleDraft.replace(/\s+/g, ' ').trim();
    if (!next) {
      setTitleDraft(issue.title);
      return;
    }
    if (next === issue.title) return;
    setTitleDraft(next);
    if (!(await patchIssue({ title: next }))) setTitleDraft(issue.title);
  }

  // El editor puede avisar dos veces (botón Guardar y foco que sale): el ref
  // evita guardar después de cancelar o de haber guardado ya.
  const descOpen = useRef(false);
  useEffect(() => {
    descOpen.current = editingDesc;
  }, [editingDesc]);

  function cancelDescription() {
    descOpen.current = false;
    setDescDraft(parseDescription(issue.description));
    setEditingDesc(false);
  }

  async function saveDescriptionText(next: string): Promise<boolean> {
    const res = await fetch(`/api/track/issues/${issue.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: next ? [{ type: 'text', text: next }] : [] }),
    }).catch(() => null);
    if (!res?.ok) {
      setSaveError(ui.inline.saveError);
      return false;
    }
    await handleIssueChange();
    return true;
  }

  async function saveDescription() {
    if (!descOpen.current) return;
    descOpen.current = false;
    setEditingDesc(false);
    const next = descDraft.trim();
    const current = parseDescription(issue.description).trim();
    if (next === current) return;
    if (!(await saveDescriptionText(next))) setDescDraft(current);
  }

  // Tildar una tarea de la descripción desde la lectura (como en Linear).
  async function toggleTask(index: number) {
    const before = descDraft;
    const next = toggleTaskInSource(before, index);
    if (next === before) return;
    setDescDraft(next);
    if (!(await saveDescriptionText(next.trim()))) setDescDraft(before);
  }

  // Pegar o soltar imágenes en la descripción o un comentario: se suben como adjunto.
  const uploadInline = useCallback(
    async (file: File): Promise<UploadResult | null> => {
      if (file.size > 10 * 1024 * 1024) {
        setAttachmentError(labels.attachments.tooLarge);
        return null;
      }
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/track/issues/${issue.id}/attachments`, { method: 'POST', body: form }).catch(() => null);
      if (!res?.ok) return null;
      const row = (await res.json()) as { url: string; filename: string; content_type?: string };
      void refreshAttachments();
      void refreshActivities();
      return { url: row.url, filename: row.filename, image: (row.content_type ?? file.type).startsWith('image/') };
    },
    [issue.id, labels.attachments.tooLarge, refreshAttachments, refreshActivities],
  );

  const branchName = branchNameFor(issue.identifier, titleDraft || issue.title);

  const announceCopied = useCallback((message: string) => {
    setCopied(message);
    pushNotice(message);
    window.setTimeout(() => setCopied(null), 1500);
  }, []);

  const copyLink = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href.split('#')[0]).catch(() => undefined);
    announceCopied(t('issues.linkCopied'));
  }, [t, announceCopied]);

  // Borrar con ventana para deshacer: el issue sale de las listas al instante
  // y el DELETE se manda cuando vence el toast.
  function handleDelete() {
    setConfirmDelete(false);
    const id = issue.id;
    scheduleDelete({
      ids: [id, ...childStore.issues.map((c) => c.id)],
      label: tx('undo.deleted', { id: issue.identifier }),
      commit: async (keepalive) => {
        await fetch(`/api/track/issues/${id}`, { method: 'DELETE', keepalive }).catch(() => undefined);
      },
      restore: () => router.push(`/app/track/issues/${id}`),
    });
    router.push(`/app/track/projects/${issue.project_id}`);
  }

  // ⌘⌫ borra (con confirmación), ⌘⇧, copia el link y ⌘⇧↑ abre el padre, como en Linear.
  const parent = parentChain[parentChain.length - 1] ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'ArrowUp' && parent) {
        e.preventDefault();
        router.push(`/app/track/issues/${parent.id}`);
        return;
      }
      const action = issueKeyAction(e);
      if (!action) return;
      if (action === 'delete') {
        if (!canDelete) return;
        e.preventDefault();
        setConfirmDelete(true);
      } else {
        e.preventDefault();
        copyLink();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDelete, copyLink, parent, router]);

  // ---------- ⌘K y atajos de una tecla ----------

  useTrackCommands({
    lookup: (id) => (id === issueRef.current.id ? issueRef.current : childStore.issues.find((c) => c.id === id)),
    getTargets: () => {
      // Una fila de sub-issue bajo el mouse (o activa con J/K) gana sobre el issue abierto.
      const rowId = rowTargetId();
      const child = rowId ? childStore.issues.find((c) => c.id === rowId) : null;
      return [child ?? issueRef.current];
    },
    data: {
      statuses: initialStatuses,
      members: initialMembers,
      labels: workspaceLabels,
      cycles: initialCycles,
      milestones: initialMilestones,
      priorities: labels.priorities,
      meId: userId,
      today,
    },
    handlers: {
      apply: (targets, patch) => {
        for (const target of targets) {
          const p = typeof patch === 'function' ? patch(target) : patch;
          if (target.id === issueRef.current.id) void patchIssue(p);
          else void childStore.update(target.id, p);
        }
      },
      createSubIssue: (p) => {
        if (p.id === issueRef.current.id) setComposerSignal((n) => n + 1);
        else router.push(`/app/track/issues/${p.id}`);
      },
      remove: canDelete
        ? (targets) => {
            if (targets.some((x) => x.id === issueRef.current.id)) {
              setConfirmDelete(true);
              return;
            }
            const ids = targets.map((x) => x.id);
            const snapshot = childStore.issues;
            childStore.setIssues((list) => list.filter((c) => !ids.includes(c.id)));
            scheduleDelete({
              ids,
              label: tx('undo.deleted', { id: targets.length === 1 ? targets[0].identifier : String(targets.length) }),
              commit: async (keepalive) => {
                await Promise.all(ids.map((id) => fetch(`/api/track/issues/${id}`, { method: 'DELETE', keepalive }).catch(() => undefined)));
              },
              restore: () => childStore.setIssues(snapshot),
            });
          }
        : undefined,
      open: (i) => router.push(`/app/track/issues/${i.id}`),
    },
    t: (k, v) => tc(k, v),
    formatDay: (iso) => formatDay(iso, locale, today),
    extra: (targets) => (targets[0]?.id === issueRef.current.id ? [addExistingAction()] : []),
  });

  // ---------- Adjuntos y relaciones ----------

  async function handleUpload(file: File) {
    setAttachmentError(null);
    if (file.size > 10 * 1024 * 1024) {
      setAttachmentError(labels.attachments.tooLarge);
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`/api/track/issues/${issue.id}/attachments`, { method: 'POST', body: form }).catch(
        () => null,
      );
      if (res?.ok) {
        await Promise.all([refreshAttachments(), refreshActivities()]);
      } else if (res?.status === 413) {
        setAttachmentError(labels.attachments.tooLarge);
      } else if (res?.status === 415) {
        setAttachmentError(labels.attachments.typeNotAllowed);
      } else {
        setAttachmentError(labels.attachments.uploadError);
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAttachment(fileId: string) {
    const res = await fetch(`/api/track/issues/${issue.id}/attachments?fileId=${fileId}`, { method: 'DELETE' });
    if (res.ok) await refreshAttachments();
  }

  async function handleAddRelation(e: React.FormEvent) {
    e.preventDefault();
    if (!relationInput.trim()) return;
    setRelationError(null);
    const res = await fetch(`/api/track/issues/${issue.id}/relations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relatedIssueId: relationInput.trim(), type: relationType }),
    }).catch(() => null);
    if (res?.ok) {
      setRelationInput('');
      setShowRelationForm(false);
      await Promise.all([refreshRelations(), refreshActivities()]);
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
    setRelationError(
      res?.status === 404
        ? labels.relations.notFound
        : code === 'duplicate_relation'
          ? labels.relations.duplicate
          : code === 'invalid_relation'
            ? labels.relations.self
            : labels.relations.error,
    );
  }

  async function handleDeleteRelation(relationId: string) {
    const res = await fetch(`/api/track/issues/${issue.id}/relations?relationId=${relationId}`, { method: 'DELETE' });
    if (res.ok) {
      await Promise.all([refreshRelations(), refreshActivities()]);
    }
  }

  // El padre cambió (⌘⇧P o "Quitar padre"): el breadcrumb se vuelve a pedir.
  useEffect(() => {
    if (issue.parent_id === (parentChain[parentChain.length - 1]?.id ?? null)) return;
    if (!issue.parent_id) {
      setParentChain([]);
      return;
    }
    setParentChain([{ id: issue.parent_id, identifier: issue.parent_identifier ?? '…', title: issue.parent_title ?? '' }]);
  }, [issue.parent_id, issue.parent_identifier, issue.parent_title, parentChain]);

  const outgoing = relations.filter((r) => r.direction === 'outgoing');
  const incoming = relations.filter((r) => r.direction === 'incoming');

  function relationLabel(type: string, direction: 'outgoing' | 'incoming') {
    if (type === 'blocks') return direction === 'outgoing' ? labels.relations.blocks : labels.relations.blockedBy;
    if (type === 'duplicates') return direction === 'outgoing' ? labels.relations.duplicates : labels.relations.duplicatedBy;
    return labels.relations.related;
  }

  return (
    <div className="app-page track-detail" data-track-project-id={issue.project_id}>
      <header className="track-detail-head">
        <div className="track-detail-topbar">
          <nav className="track-breadcrumb" aria-label={labels.back}>
            <Link href={`/app/track/projects/${issue.project_id}`}>{initialProjectName}</Link>
            {parentChain.map((p) => (
              <span key={p.id} className="track-breadcrumb-step">
                <span className="track-breadcrumb-sep" aria-hidden>
                  ›
                </span>
                <Link href={`/app/track/issues/${p.id}`} title={p.title} className="track-identifier">
                  {p.identifier}
                </Link>
              </span>
            ))}
            <span className="track-breadcrumb-sep" aria-hidden>
              ›
            </span>
            <span className="track-breadcrumb-current track-identifier" aria-current="page">
              {issue.identifier}
            </span>
          </nav>
          <div className="track-detail-actions">
            {viewers.length > 0 && (
              <span
                className="track-presence"
                data-testid="track-presence"
                title={tx('presence.viewing', { names: viewers.map((v) => v.name).join(', ') })}
              >
                <TrackIcon name="eye" size={12} />
                {viewers.slice(0, 3).map((v) => (
                  <span key={v.id} className="track-avatar is-small">
                    {v.name[0]?.toUpperCase() ?? '?'}
                  </span>
                ))}
                <span className="sr-only">{tx('presence.viewing', { names: viewers.map((v) => v.name).join(', ') })}</span>
              </span>
            )}
            <IssueReminder issueId={issue.id} locale={locale} initial={initialReminder ?? null} />
            <IssueSubscription
              issueId={issue.id}
              initialSubscribed={initialSubscribed}
              refreshKey={activities.length}
              labels={labels.subscription}
            />
            <Popover
              ariaLabel={labels.edit.more}
              className="btn btn-icon track-detail-more"
              width={300}
              trigger={<TrackIcon name="more" size={16} />}
            >
              {(close) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-menu-item"
                    data-autofocus
                    onClick={() => {
                      close();
                      setComposerSignal((n) => n + 1);
                    }}
                    data-testid="track-menu-subissue"
                  >
                    <span className="track-menu-label">{tc('createSubIssue')}</span>
                    <kbd className="track-menu-meta">{mac ? '⌘⇧O' : 'Ctrl+Shift+O'}</kbd>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-menu-item"
                    onClick={() => {
                      close();
                      window.setTimeout(() => openCommandMenu('parent'), 0);
                    }}
                  >
                    <span className="track-menu-label">{tc('setParent')}</span>
                    <kbd className="track-menu-meta">{mac ? '⌘⇧P' : 'Ctrl+Shift+P'}</kbd>
                  </button>
                  {issue.parent_id && (
                    <button
                      type="button"
                      role="menuitem"
                      className="track-menu-item"
                      onClick={() => {
                        close();
                        void patchIssue({ parentId: null });
                      }}
                      data-testid="track-remove-parent"
                    >
                      <span className="track-menu-label">{tc('removeParent')}</span>
                    </button>
                  )}
                  <div className="track-menu-sep" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="track-menu-item"
                    onClick={() => {
                      void navigator.clipboard?.writeText(issue.identifier).catch(() => undefined);
                      announceCopied(tc('copied', { what: issue.identifier }));
                      close();
                    }}
                  >
                    <span className="track-menu-label">{tc('copyId')}</span>
                    <kbd className="track-menu-meta">{mac ? '⌘.' : 'Ctrl+.'}</kbd>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-menu-item"
                    data-testid="track-copy-link"
                    aria-keyshortcuts="Meta+Shift+Comma Control+Shift+Comma"
                    onClick={() => {
                      copyLink();
                      close();
                    }}
                  >
                    <span className="track-menu-label">{t('issues.copyLink')}</span>
                    <kbd className="track-menu-meta">{issueKeyHint('copyLink', mac)}</kbd>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="track-menu-item"
                    data-testid="track-copy-branch"
                    data-branch={branchName}
                    onClick={() => {
                      void navigator.clipboard?.writeText(branchName).catch(() => undefined);
                      announceCopied(labels.edit.copied);
                      close();
                    }}
                  >
                    <span className="track-menu-label is-fixed">{labels.edit.copyBranch}</span>
                    <span className="track-menu-meta track-menu-meta-trunc data">{branchName}</span>
                  </button>
                  {canDelete && (
                    <>
                      <div className="track-menu-sep" role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        className="track-menu-item is-danger"
                        data-testid="track-issue-delete"
                        aria-keyshortcuts="Meta+Backspace Control+Backspace"
                        onClick={() => {
                          close();
                          setConfirmDelete(true);
                        }}
                      >
                        <span className="track-menu-label">{t('issues.deleteIssue')}</span>
                        <kbd className="track-menu-meta">{issueKeyHint('delete', mac)}</kbd>
                      </button>
                    </>
                  )}
                </>
              )}
            </Popover>
            {(doneStatus || openStatus) && (
              <button type="button" className="btn btn-sm" onClick={handleCloseReopen}>
                {isClosed ? labels.actions.reopen : labels.actions.close}
              </button>
            )}
          </div>
        </div>
        <span className="sr-only" role="status">
          {copied ?? ''}
        </span>
        {issue.triage === 1 && (
          <TriageBanner key={issue.id} issue={issue} statuses={initialStatuses} onResolved={() => void handleIssueChange()} />
        )}
      </header>

      <div className="track-detail-grid">
        <div className="track-detail-main">
          {parent && (
            <Link href={`/app/track/issues/${parent.id}`} className="track-parent-line" data-testid="track-parent-line">
              <TrackIcon name="parent" size={12} />
              <span>{tx('sub.of')}</span>
              <span className="track-identifier">{parent.identifier}</span>
              <span className="track-parent-title">{parent.title}</span>
            </Link>
          )}
          <h1 className="track-detail-title">
            <textarea
              ref={titleRef}
              className="track-detail-title-input"
              value={titleDraft}
              rows={1}
              maxLength={500}
              placeholder={labels.untitled}
              aria-label={labels.edit.title}
              onFocus={() => (titleFocused.current = true)}
              onChange={(e) => setTitleDraft(e.target.value.replace(/\n/g, ' '))}
              onBlur={() => {
                titleFocused.current = false;
                void saveTitle();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setTitleDraft(issue.title);
                  window.setTimeout(() => (e.target as HTMLTextAreaElement).blur(), 0);
                }
              }}
              data-testid="track-issue-title"
            />
          </h1>

          <section className="track-detail-section track-detail-description" aria-label={labels.description}>
            {editingDesc ? (
              <div className="track-description-editor">
                <MarkdownEditor
                  value={descDraft}
                  onValueChange={setDescDraft}
                  labels={ui.markdown}
                  textareaRef={descRef}
                  members={initialMembers}
                  onUpload={uploadInline}
                  // Salir del editor (clic afuera) guarda, como antes con el blur del textarea.
                  onBlurOutside={() => void saveDescription()}
                  textareaProps={{
                    className: 'textarea',
                    rows: 4,
                    autoFocus: true,
                    maxLength: 5000,
                    placeholder: labels.edit.descriptionPlaceholder,
                    'aria-label': labels.description,
                    onKeyDown: (e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        cancelDescription();
                      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void saveDescription();
                      }
                    },
                    'data-testid': 'track-issue-description',
                  }}
                />
                <div className="track-description-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={cancelDescription}
                  >
                    {labels.activity.cancelEdit}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void saveDescription()}
                  >
                    {labels.activity.saveComment}
                  </button>
                </div>
              </div>
            ) : descDraft.trim() ? (
              // Con contenido: se lee renderizado (links y tareas funcionan); clic en el texto edita.
              <div className="track-description-read">
                <div
                  className="track-description"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a, input, button')) return;
                    if (window.getSelection()?.toString()) return;
                    setEditingDesc(true);
                  }}
                  data-testid="track-issue-description"
                >
                  <MarkdownView source={descDraft} onToggleTask={(i) => void toggleTask(i)} />
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon track-description-edit"
                  onClick={() => setEditingDesc(true)}
                  aria-label={labels.edit.editDescription}
                  title={labels.edit.editDescription}
                >
                  <TrackIcon name="pencil" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="track-description is-empty"
                onClick={() => setEditingDesc(true)}
                aria-label={labels.edit.descriptionPlaceholder}
                data-testid="track-issue-description"
              >
                {labels.edit.descriptionPlaceholder}
              </button>
            )}
          </section>

          <SubIssues
            parent={issue}
            store={childStore}
            project={project}
            ui={ui}
            composerSignal={composerSignal}
            onCreate={createSubIssue}
            onAddExisting={() => openCommandMenu('add-sub')}
          />

          <div className="track-detail-add">
            <label className="track-attachment-upload">
              <input
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                  e.currentTarget.value = '';
                }}
                disabled={uploading}
              />
              <span className="btn btn-ghost btn-sm" aria-busy={uploading || undefined}>
                <TrackIcon name="pin" size={12} /> {labels.edit.addAttachment}
              </span>
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowRelationForm(true)}
              aria-expanded={showRelationForm}
            >
              <TrackIcon name="link" size={12} /> {labels.edit.addRelation}
            </button>
          </div>
          {(attachmentError || childStore.error) && (
            <p className="ui-error" role="alert">
              {attachmentError ?? childStore.error}
            </p>
          )}

          <IssueGithubPanel data={github} />
          <IssueLinksPanel issueId={issue.id} />

          {attachments.length > 0 && (
            <section className="track-detail-section">
              <h2 className="track-section-title">{labels.attachments.title}</h2>
              <ul className="track-attachment-list">
                {attachments.map((a) => (
                  <li key={a.id} className="track-attachment">
                    <a href={a.url} target="_blank" rel="noreferrer" className="track-attachment-name">
                      {a.filename}
                    </a>
                    <span className="track-attachment-meta">
                      {formatBytes(a.size)} · {a.user_name ?? a.user_email} · {relDate(a.created_at, locale)}
                    </span>
                    {a.user_id === userId && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-danger"
                        onClick={() => handleDeleteAttachment(a.id)}
                      >
                        {labels.attachments.delete}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(relations.length > 0 || showRelationForm) && (
            <section className="track-detail-section">
              <h2 className="track-section-title">{labels.relations.title}</h2>

              {outgoing.length > 0 && (
                <div className="track-relation-group">
                  <h3 className="track-relation-heading">{labels.relations.outgoing}</h3>
                  <ul className="track-relation-list">
                    {outgoing.map((r) => (
                      <li key={r.id} className="track-relation">
                        <span className="track-relation-type">{relationLabel(r.type, 'outgoing')}</span>
                        <Link href={`/app/track/issues/${r.related_issue_id}`}>
                          <span className="track-identifier">{r.identifier}</span> {r.title}
                        </Link>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDeleteRelation(r.id)}>
                          {labels.relations.remove}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {incoming.length > 0 && (
                <div className="track-relation-group">
                  <h3 className="track-relation-heading">{labels.relations.incoming}</h3>
                  <ul className="track-relation-list">
                    {incoming.map((r) => (
                      <li key={r.id} className="track-relation">
                        <span className="track-relation-type">{relationLabel(r.type, 'incoming')}</span>
                        <Link href={`/app/track/issues/${r.issue_id}`}>
                          <span className="track-identifier">{r.identifier}</span> {r.title}
                        </Link>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDeleteRelation(r.id)}>
                          {labels.relations.remove}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {showRelationForm && (
                <form
                  className="track-relation-form"
                  onSubmit={handleAddRelation}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setShowRelationForm(false);
                    }
                  }}
                >
                  <select
                    className="select"
                    aria-label={labels.relations.selectType}
                    value={relationType}
                    onChange={(e) => setRelationType(e.target.value as (typeof RELATION_TYPES)[number])}
                  >
                    {RELATION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {relationLabel(type, 'outgoing')}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input data"
                    type="text"
                    value={relationInput}
                    onChange={(e) => setRelationInput(e.target.value)}
                    placeholder={labels.relations.selectIssue}
                    aria-label={labels.relations.selectIssue}
                    autoFocus
                  />
                  <span className="track-inline-form-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowRelationForm(false)}>
                      {labels.relations.cancel}
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={!relationInput.trim()}>
                      {labels.relations.add}
                    </button>
                  </span>
                </form>
              )}
              {relationError && (
                <p className="ui-error" role="alert">
                  {relationError}
                </p>
              )}
            </section>
          )}

          {/* Triage e IA (T3): resumen, pedidos de clientes y sesión del agente. */}
          <IssueMainExtras issueId={issue.id} locale={locale} onIssueChange={() => void handleIssueChange()} />

          <section className="track-detail-section track-detail-activity">
            <h2 className="track-section-title">
              {labels.activity.title}
              <span className="track-section-meta">{labels.createdOn.replace('{date}', formatDate(issue.created_at, locale))}</span>
            </h2>
            <IssueActivityTimeline
              issueId={issue.id}
              locale={locale}
              userId={userId}
              activities={activities}
              reactions={reactions}
              onReactions={setReactions}
              members={initialMembers}
              labels={labels.activity}
              markdownLabels={ui.markdown}
              attachments={attachments}
              onUpload={uploadInline}
              onChange={refreshActivities}
            />
          </section>
        </div>

        <aside className="track-detail-side">
          <section className="track-detail-props" aria-label={labels.properties.title}>
            <IssueSidebar
              issue={issue}
              projectId={issue.project_id}
              projectName={initialProjectName}
              statuses={initialStatuses}
              cycles={initialCycles}
              milestones={initialMilestones}
              members={initialMembers}
              locale={locale}
              ui={ui}
              today={today}
              labels={labels.properties}
              onPatch={(patch) => void patchIssue(patch)}
              onLabels={(next) => void setLabels(next)}
            />
            <IssueSideExtras issueId={issue.id} watch={`${issue.priority}|${issue.status_id}|${issue.triage}`} />
          </section>
        </aside>
      </div>
      <TrackToast message={saveError} onDismiss={() => setSaveError(null)} dismissLabel={ui.inline.dismiss} />
      <ConfirmDialog
        open={confirmDelete}
        title={t('issues.deleteTitle', { identifier: issue.identifier })}
        body={t('issues.deleteBody')}
        confirmLabel={t('bulk.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
