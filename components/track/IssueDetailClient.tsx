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
import RichEditor, { type UploadResult } from './RichEditor';
import TrackIcon from './TrackIcon';
import IssueSubscription from './IssueSubscription';
import IssueReminder from './IssueReminder';
import IssueSidebar from './IssueSidebar';
import SubIssues, { ProgressRing } from './SubIssues';
import { useWorkspaceLabels } from './LabelPicker';
import { applyIssuePatch, findDoneStatus, findOpenStatus, formatDay, inversePatch, type IssuePatch } from '@/lib/track-tasks';
import { useIssueStore, type ProjectContext } from './useIssueStore';
import { issueHref, isTypingTarget as isTextTarget, rowTargetId, useTrackCommands } from './trackCommands';
import { readListNav } from './trackNav';
import { TRACK_VIEWS_CHANGED } from './TrackBranch';
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
import { teamKeyOf, teamPath } from '@/lib/track-routes';
import { TRACK_MARKDOWN_MAX } from '@/lib/track-markdown';

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
  /** Si el issue está en sus favoritos (estrella). */
  initialFavorite?: boolean;
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
  initialFavorite = false,
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
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(initialIssue.title);
  const [descDraft, setDescDraft] = useState(() => parseDescription(initialIssue.description));
  const [composerSignal, setComposerSignal] = useState(0);
  // Secciones que no se muestran vacías (como Linear): se abren desde el menú "+".
  const [linksSignal, setLinksSignal] = useState(0);
  const [summarizeSignal, setSummarizeSignal] = useState(0);
  const [requestSignal, setRequestSignal] = useState(0);
  const subscriptionApi = useRef<{ subscribed: boolean; toggle: () => void } | null>(null);
  // Estrella (favoritos en el sidebar, como Linear).
  const [favorite, setFavorite] = useState(initialFavorite);
  const toggleFavorite = useCallback(async () => {
    const next = !favorite;
    setFavorite(next);
    const res = await fetch(`/api/track/issues/${issueRef.current.id}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setFavorite(!next);
      setSaveError(ui.inline.saveError);
      return;
    }
    window.dispatchEvent(new Event(TRACK_VIEWS_CHANGED));
    pushNotice(next ? tx('fav.added') : tx('fav.removed'));
  }, [favorite, tx, ui.inline.saveError]);
  const attachInputRef = useRef<HTMLInputElement>(null);
  // Aviso para lectores de pantalla tras copiar (rama o link).
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mac, setMac] = useState(true);
  const [workspaceLabels] = useWorkspaceLabels();
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  const titleRef = useAutosize(titleDraft);
  const titleFocused = useRef(false);

  // URL como Linear: /app/track/issue/WEB-12/titulo (también si se entró por el UUID o por un ID viejo).
  useEffect(() => {
    const m = /^(.*?\/app\/track\/)(issues\/[^/?#]+|issue\/[^?#]+)$/.exec(window.location.pathname);
    if (!m) return;
    const canonical = `${m[1]}${issueHref(issue).replace('/app/track/', '')}`;
    if (canonical !== window.location.pathname) {
      window.history.replaceState(window.history.state, '', `${canonical}${window.location.search}${window.location.hash}`);
    }
  }, [issue]);

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
    if (!descOpen.current && !descTimer.current) {
      const text = parseDescription(next.description);
      descSaved.current = text.trim();
      descLatest.current = text;
      setDescDraft(text);
    }
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
        pushUndo(
          tx('undo.updatedOne', { id: prev.identifier }),
          async () => {
            await patchIssueRef.current(inverse, { undo: false });
          },
          async () => {
            await patchIssueRef.current(patch, { undo: false });
          },
          { silent: true },
        );
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
    pushUndo(
      tx('undo.updatedOne', { id: prev.identifier }),
      async () => {
        await patchIssueRef.current(inverse, { undo: false });
      },
      async () => {
        const again = await fetch(`/api/track/issues/${prev.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ labels: next }),
        }).catch(() => null);
        if (again?.ok) setIssue((await again.json()) as TrackIssueWithStatus);
        void refreshActivities();
      },
    );
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
              const setParent = (parentId: string | null) => async () => {
                await fetch(`/api/track/issues/${r.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ parentId }),
                });
                await refreshChildren();
              };
              pushUndo(tx('undo.updatedOne', { id: r.identifier }), setParent(r.parent_id), setParent(me.id));
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

  // Descripción siempre editable: se guarda al dejar de tipear un momento y al
  // salir del editor. Mientras tiene el foco, los refrescos no la pisan.
  const descOpen = useRef(false);
  const descTimer = useRef<number | null>(null);
  const descLatest = useRef(descDraft);
  const descSaved = useRef(parseDescription(initialIssue.description).trim());

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
    descSaved.current = next;
    await handleIssueChange();
    return true;
  }

  async function flushDescription() {
    if (descTimer.current) window.clearTimeout(descTimer.current);
    descTimer.current = null;
    const next = descLatest.current.trim();
    if (next === descSaved.current || next.length > TRACK_MARKDOWN_MAX) return;
    await saveDescriptionText(next);
  }

  function changeDescription(md: string) {
    descLatest.current = md;
    setDescDraft(md);
    if (descTimer.current) window.clearTimeout(descTimer.current);
    descTimer.current = window.setTimeout(() => void flushDescription(), 1500);
  }

  // Al salir de la página con cambios sin guardar, se mandan igual.
  useEffect(
    () => () => {
      if (descTimer.current) {
        window.clearTimeout(descTimer.current);
        const next = descLatest.current.trim();
        if (next !== descSaved.current && next.length <= TRACK_MARKDOWN_MAX) {
          void fetch(`/api/track/issues/${issue.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: next ? [{ type: 'text', text: next }] : [] }),
            keepalive: true,
          }).catch(() => null);
        }
      }
    },
    [issue.id],
  );

  // Pegar o soltar imágenes en la descripción o un comentario: se suben como adjunto.
  const uploadInline = useCallback(
    async (file: File): Promise<UploadResult | null> => {
      if (file.size > 10 * 1024 * 1024) {
        setAttachmentError(labels.attachments.tooLarge);
        return null;
      }
      const form = new FormData();
      form.append('file', file);
      // Inline: la imagen vive en el texto, no se lista otra vez en Adjuntos.
      form.append('inline', '1');
      const res = await fetch(`/api/track/issues/${issue.id}/attachments`, { method: 'POST', body: form }).catch(() => null);
      if (!res?.ok) return null;
      const row = (await res.json()) as { url: string; filename: string; content_type?: string };
      return { url: row.url, filename: row.filename, image: (row.content_type ?? file.type).startsWith('image/') };
    },
    [issue.id, labels.attachments.tooLarge],
  );

  const branchName = branchNameFor(issue.identifier, titleDraft || issue.title);

  const announceCopied = useCallback((message: string) => {
    setCopied(message);
    pushNotice(message);
    window.setTimeout(() => setCopied(null), 1500);
  }, []);

  const copyLink = useCallback(() => {
    void navigator.clipboard?.writeText(new URL(issueHref(issueRef.current), window.location.origin).toString()).catch(() => undefined);
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
    router.push(teamPath(teamKeyOf(issue)));
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

  // ---------- Mover de team, archivar y restaurar (como Linear) ----------

  const moveToTeam = useCallback(
    async (targets: TrackIssueWithStatus[], teamId: string, opts: { undo?: boolean } = {}) => {
      const moved: Array<{ before: TrackIssueWithStatus; after: TrackIssueWithStatus }> = [];
      for (const target of targets) {
        const res = await fetch(`/api/track/issues/${target.id}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId }),
        }).catch(() => null);
        if (!res?.ok) {
          setSaveError(tx('side.moveError'));
          continue;
        }
        moved.push({ before: target, after: (await res.json()) as TrackIssueWithStatus });
      }
      if (!moved.length) return;
      const main = moved.find((m) => m.before.id === issueRef.current.id);
      if (main) setIssue(main.after);
      await refreshChildren();
      // Estados, cycles y miembros del team nuevo vienen del servidor.
      router.refresh();
      const team = moved[0].after;
      if (opts.undo === false) pushNotice(tx('side.moved', { team: teamKeyOf(team), id: team.identifier }));
      else {
        const back = moved.map((m) => ({ id: m.before.id, teamId: m.before.project_id }));
        pushUndo(
          tx('side.moved', { team: teamKeyOf(team), id: team.identifier }),
          async () => {
            for (const b of back) {
              await fetch(`/api/track/issues/${b.id}/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teamId: b.teamId }),
              }).catch(() => null);
            }
            await handleIssueChange();
            router.refresh();
          },
          async () => {
            await moveToTeamRef.current(
              moved.map((m) => m.after),
              teamId,
              { undo: false },
            );
          },
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, tx, refreshChildren],
  );
  const moveToTeamRef = useRef(moveToTeam);
  moveToTeamRef.current = moveToTeam;

  const setArchived = useCallback(
    async (ids: string[], archive: boolean, opts: { undo?: boolean } = {}) => {
      const res = await fetch('/api/track/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(archive ? { issueIds: ids, archive: true } : { issueIds: ids }),
      }).catch(() => null);
      if (!res?.ok) {
        setSaveError(ui.inline.saveError);
        return;
      }
      await handleIssueChange();
      await refreshChildren();
      const label = tx(archive ? 'side.archivedNotice' : 'side.restored', { id: issueRef.current.identifier });
      if (opts.undo === false) pushNotice(label);
      else
        pushUndo(
          label,
          () => setArchivedRef.current(ids, !archive, { undo: false }),
          () => setArchivedRef.current(ids, archive, { undo: false }),
        );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tx, ui.inline.saveError, refreshChildren],
  );
  const setArchivedRef = useRef(setArchived);
  setArchivedRef.current = setArchived;

  // ---------- Relaciones y duplicados (desde ⌘K, sin formularios) ----------

  const addRelation = useCallback(
    async (fromId: string, toId: string, type: (typeof RELATION_TYPES)[number]) => {
      const res = await fetch(`/api/track/issues/${fromId}/relations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relatedIssueId: toId, type }),
      }).catch(() => null);
      if (!res?.ok) {
        const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
        setSaveError(code === 'duplicate_relation' ? labels.relations.duplicate : code === 'invalid_relation' ? labels.relations.self : labels.relations.error);
        return false;
      }
      await Promise.all([refreshRelations(), refreshActivities()]);
      return true;
    },
    [labels.relations, refreshRelations, refreshActivities],
  );

  // Como "Mark as duplicate" de Linear: relación con el original y el issue pasa a cancelado.
  const markDuplicate = useCallback(
    async (target: TrackIssueWithStatus, canonical: TrackIssueWithStatus) => {
      if (!(await addRelation(target.id, canonical.id, 'duplicates'))) return;
      const cancelled = [...initialStatuses].sort((a, b) => a.position - b.position).find((st) => st.category === 'cancelled');
      if (cancelled && target.id === issueRef.current.id) await patchIssueRef.current({ statusId: cancelled.id }, { undo: false });
      pushNotice(tc('markedDuplicate', { id: target.identifier, of: canonical.identifier }));
    },
    [addRelation, initialStatuses, tc],
  );

  const relationActions = useCallback((): CommandAction[] => {
    const search = async (q: string) => {
      const sp = new URLSearchParams({ pageSize: '12' });
      if (q.trim()) sp.set('q', q.trim());
      const res = await fetch(`/api/track/issues?${sp.toString()}`).catch(() => null);
      if (!res?.ok) return [];
      return ((await res.json()) as { rows: TrackIssueWithStatus[] }).rows.filter((r) => r.id !== issueRef.current.id);
    };
    const make = (id: string, label: string, run: (r: TrackIssueWithStatus) => void): CommandAction => ({
      id,
      label,
      keywords: 'relation relación relação link blocks bloquea related relacionado',
      placeholder: tc('searchParent'),
      icon: { kind: 'glyph', name: 'link' },
      children: () => [],
      load: async (q) =>
        (await search(q)).map((r) => ({
          id: `${id}:${r.id}`,
          label: `${r.identifier} ${r.title}`,
          icon: { kind: 'status' as const, color: r.status_color ?? null, category: r.status_category ?? null },
          run: () => run(r),
        })),
    });
    const me = () => issueRef.current.id;
    return [
      make('relate-blocks', tx('rel.blocks'), (r) => void addRelation(me(), r.id, 'blocks')),
      make('relate-blocked', tx('rel.blockedBy'), (r) => void addRelation(r.id, me(), 'blocks')),
      make('relate-related', tx('rel.related'), (r) => void addRelation(me(), r.id, 'related')),
    ];
  }, [tc, tx, addRelation]);

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
      moveToTeam: (targets, teamId) => void moveToTeam(targets, teamId),
      archive: (targets) => void setArchived(targets.map((x) => x.id), true),
      markDuplicate: (target, canonical) => void markDuplicate(target, canonical),
      subscription: {
        subscribed: () => subscriptionApi.current?.subscribed ?? false,
        toggle: () => subscriptionApi.current?.toggle(),
      },
    },
    t: (k, v) => tc(k, v),
    formatDay: (iso) => formatDay(iso, locale, today),
    extra: (targets) => (targets[0]?.id === issueRef.current.id ? [addExistingAction(), ...relationActions()] : []),
    // Sobre el issue abierto, S/P/A/L… abren el menú debajo del chip del panel (como Linear).
    anchorFor: (page, targets) =>
      targets.length === 1 && targets[0].id === issueRef.current.id
        ? document.querySelector(`.track-detail-side [data-cmd-anchor="${page}"]`)
        : null,
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

  async function handleDeleteRelation(relationId: string) {
    const res = await fetch(`/api/track/issues/${issue.id}/relations?relationId=${relationId}`, { method: 'DELETE' });
    if (res.ok) {
      await Promise.all([refreshRelations(), refreshActivities()]);
    }
  }

  // El padre cambió (⌘⇧P, "Quitar padre" o su ⌘Z): el breadcrumb se arma de
  // nuevo pidiendo la cadena de padres (nunca queda en "…").
  useEffect(() => {
    if (issue.parent_id === (parentChain[parentChain.length - 1]?.id ?? null)) return;
    if (!issue.parent_id) {
      setParentChain([]);
      return;
    }
    let alive = true;
    const first = issue.parent_id;
    if (issue.parent_identifier) setParentChain([{ id: first, identifier: issue.parent_identifier, title: issue.parent_title ?? '' }]);
    void (async () => {
      const chain: IssueParentSummary[] = [];
      let next: string | null = first;
      const seen = new Set<string>([issue.id]);
      while (next && !seen.has(next) && chain.length < 8) {
        seen.add(next);
        const res = await fetch(`/api/track/issues/${next}`).catch(() => null);
        if (!res?.ok) break;
        const p = (await res.json()) as TrackIssueWithStatus;
        chain.unshift({ id: p.id, identifier: p.identifier, title: p.title });
        next = p.parent_id;
      }
      if (alive && chain.length) setParentChain(chain);
    })();
    return () => {
      alive = false;
    };
  }, [issue.id, issue.parent_id, issue.parent_identifier, issue.parent_title, parentChain]);

  // Hermanos (sub-issue): progreso del padre arriba y J/K entre hermanos.
  const [siblings, setSiblings] = useState<TrackIssueWithStatus[]>([]);
  const parentId = issue.parent_id;
  useEffect(() => {
    if (!parentId) {
      setSiblings([]);
      return;
    }
    let alive = true;
    void fetch(`/api/track/issues/${parentId}/children`)
      .then((res) => (res.ok ? (res.json() as Promise<{ rows: TrackIssueWithStatus[] }>) : null))
      .then((data) => {
        if (alive && data) setSiblings(data.rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [parentId, issue.status_id]);

  // "4 / 12": la lista desde la que se abrió (o los hermanos si es sub-issue).
  const [listNav, setListNav] = useState<{ ids: string[]; href: string } | null>(null);
  useEffect(() => {
    const nav = readListNav();
    setListNav(nav && nav.ids.includes(issue.id) ? nav : null);
  }, [issue.id]);
  const navIds = useMemo(() => listNav?.ids ?? (siblings.length > 1 ? siblings.map((x) => x.id) : []), [listNav, siblings]);
  const navIndex = navIds.indexOf(issue.id);
  const goSibling = useCallback(
    (delta: number) => {
      if (navIndex < 0) return;
      const target = navIds[navIndex + delta];
      if (target) router.push(`/app/track/issues/${target}`);
    },
    [navIds, navIndex, router],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTextTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], dialog[open], .cmdk, [role="menu"]')) return;
      // J/K recorren los issues de la lista (como Linear); sobre una fila de sub-issue, la fila manda.
      if ((e.key === 'j' || e.key === 'k') && navIndex >= 0 && !document.querySelector('[data-issue-key].is-kb-active')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        goSibling(e.key === 'j' ? 1 : -1);
      } else if (e.key === 'Escape' && listNav) {
        e.preventDefault();
        router.push(listNav.href);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [goSibling, navIndex, listNav, router]);

  const outgoing = relations.filter((r) => r.direction === 'outgoing');
  const incoming = relations.filter((r) => r.direction === 'incoming');

  function relationLabel(type: string, direction: 'outgoing' | 'incoming') {
    if (type === 'blocks') return direction === 'outgoing' ? labels.relations.blocks : labels.relations.blockedBy;
    if (type === 'duplicates') return direction === 'outgoing' ? labels.relations.duplicates : labels.relations.duplicatedBy;
    return labels.relations.related;
  }

  const parentDone = siblings.filter((x) => x.status_category === 'done' || x.status_category === 'cancelled').length;
  const moreItem = (key: string, label: string, onClick: () => void, meta?: string, extra?: { testId?: string; danger?: boolean; autoFocus?: boolean; shortcut?: string }) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      className={`track-menu-item${extra?.danger ? ' is-danger' : ''}`}
      data-autofocus={extra?.autoFocus ? '' : undefined}
      data-testid={extra?.testId}
      aria-keyshortcuts={extra?.shortcut}
      onClick={onClick}
    >
      <span className="track-menu-label">{label}</span>
      {meta && <kbd className="track-menu-meta">{meta}</kbd>}
    </button>
  );

  return (
    <div className="app-page track-detail track-issue-page" data-track-project-id={issue.project_id} data-track-issue-id={issue.id}>
      <header className="track-detail-head">
        <div className="track-detail-topbar">
          <nav className="track-breadcrumb" aria-label={labels.back}>
            <Link href={teamPath(teamKeyOf(issue))}>{initialProjectName}</Link>
            {parentChain.map((p) => (
              <span key={p.id} className="track-breadcrumb-step">
                <span className="track-breadcrumb-sep" aria-hidden>
                  ›
                </span>
                <Link href={issueHref(p)} title={p.title} className="track-identifier">
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
            {navIndex >= 0 && navIds.length > 1 && (
              <span className="track-issue-nav" data-testid="track-issue-nav">
                <span className="track-issue-nav-count data" aria-live="polite">
                  {tx('nav.position', { n: navIndex + 1, total: navIds.length })}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon track-head-icon"
                  onClick={() => goSibling(-1)}
                  disabled={navIndex <= 0}
                  aria-label={tx('nav.prev')}
                  title={`${tx('nav.prev')} · K`}
                  aria-keyshortcuts="K"
                >
                  <TrackIcon name="up" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon track-head-icon"
                  onClick={() => goSibling(1)}
                  disabled={navIndex >= navIds.length - 1}
                  aria-label={tx('nav.next')}
                  title={`${tx('nav.next')} · J`}
                  aria-keyshortcuts="J"
                >
                  <TrackIcon name="down" size={14} />
                </button>
              </span>
            )}
            <button
              type="button"
              className={`btn btn-ghost btn-icon track-head-icon${favorite ? ' is-on' : ''}`}
              onClick={() => void toggleFavorite()}
              aria-pressed={favorite}
              aria-label={favorite ? tx('fav.remove') : tx('fav.add')}
              title={favorite ? tx('fav.remove') : tx('fav.add')}
              data-testid="track-issue-favorite"
            >
              <TrackIcon name="star" size={14} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon track-head-icon"
              onClick={copyLink}
              aria-label={t('issues.copyLink')}
              title={`${t('issues.copyLink')} · ${issueKeyHint('copyLink', mac)}`}
              data-testid="track-copy-link-head"
            >
              <TrackIcon name="link" size={14} />
            </button>
            <IssueReminder issueId={issue.id} locale={locale} initial={initialReminder ?? null} compact />
            <IssueSubscription
              issueId={issue.id}
              initialSubscribed={initialSubscribed}
              refreshKey={activities.length}
              labels={labels.subscription}
              compact
              apiRef={subscriptionApi}
            />
            <Popover
              ariaLabel={labels.edit.more}
              className="btn btn-ghost btn-icon track-head-icon track-detail-more"
              width={300}
              trigger={<TrackIcon name="more" size={16} />}
            >
              {(close) => (
                <>
                  {(doneStatus || openStatus) &&
                    moreItem('close', isClosed ? labels.actions.reopen : labels.actions.close, () => {
                      close();
                      handleCloseReopen();
                    }, undefined, { autoFocus: true, testId: 'track-close-issue' })}
                  {moreItem('sub', tc('createSubIssue'), () => {
                    close();
                    setComposerSignal((n) => n + 1);
                  }, mac ? '⌘⇧O' : 'Ctrl+Shift+O', { testId: 'track-menu-subissue' })}
                  {moreItem('parent', tc('setParent'), () => {
                    close();
                    window.setTimeout(() => openCommandMenu('parent', { targetId: issue.id }), 0);
                  }, mac ? '⌘⇧P' : 'Ctrl+Shift+P')}
                  {issue.parent_id &&
                    moreItem('remove-parent', tc('removeParent'), () => {
                      close();
                      void patchIssue({ parentId: null });
                    }, undefined, { testId: 'track-remove-parent' })}
                  {moreItem('dup', tc('markDuplicate'), () => {
                    close();
                    window.setTimeout(() => openCommandMenu('duplicate', { targetId: issue.id }), 0);
                  })}
                  {moreItem('move', tc('moveToTeam'), () => {
                    close();
                    window.setTimeout(() => openCommandMenu('move-team', { targetId: issue.id }), 0);
                  }, mac ? '⌘⇧M' : 'Ctrl+Shift+M')}
                  <div className="track-menu-sep" role="separator" />
                  {moreItem('copy-id', tc('copyId'), () => {
                    void navigator.clipboard?.writeText(issue.identifier).catch(() => undefined);
                    announceCopied(tc('copied', { what: issue.identifier }));
                    close();
                  }, mac ? '⌘.' : 'Ctrl+.')}
                  {moreItem('copy-link', t('issues.copyLink'), () => {
                    copyLink();
                    close();
                  }, issueKeyHint('copyLink', mac), { testId: 'track-copy-link', shortcut: 'Meta+Shift+Comma Control+Shift+Comma' })}
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
                  {!issue.archived_at &&
                    moreItem('archive', tc('archive'), () => {
                      close();
                      void setArchived([issue.id], true);
                    })}
                  {canDelete && (
                    <>
                      <div className="track-menu-sep" role="separator" />
                      {moreItem('delete', t('issues.deleteIssue'), () => {
                        close();
                        setConfirmDelete(true);
                      }, issueKeyHint('delete', mac), { testId: 'track-issue-delete', danger: true, shortcut: 'Meta+Backspace Control+Backspace' })}
                    </>
                  )}
                </>
              )}
            </Popover>
          </div>
        </div>
        <span className="sr-only" role="status">
          {copied ?? ''}
        </span>
        {issue.archived_at && (
          <div className="track-archived-banner" role="status" data-testid="track-archived-banner">
            <TrackIcon name="archive" size={14} />
            <span>{tx('side.archived')}</span>
            <button type="button" className="btn btn-sm" onClick={() => void setArchived([issue.id], false)} data-testid="track-restore-issue">
              {tx('side.restore')}
            </button>
          </div>
        )}
        {issue.triage === 1 && (
          <TriageBanner key={issue.id} issue={issue} statuses={initialStatuses} onResolved={() => void handleIssueChange()} />
        )}
      </header>

      <div className="track-detail-grid">
        <div className="track-detail-main">
          {parent && (
            <div className="track-parent-row">
              <Link
                href={issueHref(parent)}
                className="track-parent-line"
                data-testid="track-parent-line"
                title={`${tx('sub.of')} ${parent.identifier} · ${mac ? '⌘⇧↑' : 'Ctrl+Shift+↑'}`}
                aria-keyshortcuts="Meta+Shift+ArrowUp Control+Shift+ArrowUp"
              >
                <span>{tx('sub.of')}</span>
                {siblings.length > 0 && (
                  <span className="track-parent-progress" data-testid="track-parent-progress" title={tx('sub.nested', { done: parentDone, total: siblings.length })}>
                    <ProgressRing done={parentDone} total={siblings.length} size={12} />
                    <span className="data">
                      {parentDone}/{siblings.length}
                    </span>
                  </span>
                )}
                <span className="track-identifier">{parent.identifier}</span>
                <span className="track-parent-title">{parent.title}</span>
              </Link>
            </div>
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

          <section className="track-detail-description" aria-label={labels.description}>
            {/* Siempre editable, como en Linear: se guarda solo al dejar de tipear y al salir. */}
            <RichEditor
              key={issue.id}
              value={descDraft}
              onChange={changeDescription}
              ariaLabel={labels.description}
              placeholder={labels.edit.descriptionPlaceholder}
              testId="track-issue-description"
              members={initialMembers}
              onUpload={uploadInline}
              onFocus={() => (descOpen.current = true)}
              onBlur={() => {
                descOpen.current = false;
                void flushDescription();
              }}
              className="track-description-editor"
            />
          </section>

          {/* Debajo de la descripción, como Linear: + sub-issues, adjuntar y el resto en "…". */}
          <div className="track-issue-tools" role="toolbar" aria-label={tx('tools.more')}>
            {childStore.issues.length === 0 && (
              <button
                type="button"
                className="track-tool"
                onClick={() => setComposerSignal((n) => n + 1)}
                title={`${tx('sub.add')} · ${mac ? '⌘⇧O' : 'Ctrl+Shift+O'}`}
                aria-keyshortcuts="Meta+Shift+O Control+Shift+O"
                data-testid="track-add-subissue"
              >
                <TrackIcon name="plus" size={14} />
                <span>{tx('sub.addFirst')}</span>
              </button>
            )}
            <button
              type="button"
              className="track-tool is-icon"
              onClick={() => attachInputRef.current?.click()}
              disabled={uploading}
              aria-busy={uploading || undefined}
              aria-label={labels.edit.addAttachment}
              title={labels.edit.addAttachment}
              data-testid="track-attach"
            >
              <TrackIcon name="paperclip" size={14} />
            </button>
            <input
              ref={attachInputRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
                e.currentTarget.value = '';
              }}
            />
            <Popover ariaLabel={tx('tools.more')} className="track-tool is-icon track-tools-more" width={260} trigger={<TrackIcon name="more" size={14} />}>
              {(close) => (
                <>
                  {moreItem('existing', tx('sub.addExisting'), () => {
                    close();
                    window.setTimeout(() => openCommandMenu('add-sub'), 0);
                  }, undefined, { autoFocus: true, testId: 'track-add-existing-subissue' })}
                  {moreItem('blocks', tx('rel.blocks'), () => {
                    close();
                    window.setTimeout(() => openCommandMenu('relate-blocks', { targetId: issue.id }), 0);
                  })}
                  {moreItem('blocked', tx('rel.blockedBy'), () => {
                    close();
                    window.setTimeout(() => openCommandMenu('relate-blocked', { targetId: issue.id }), 0);
                  })}
                  {moreItem('related', tx('rel.related'), () => {
                    close();
                    window.setTimeout(() => openCommandMenu('relate-related', { targetId: issue.id }), 0);
                  }, undefined, { testId: 'track-add-relation' })}
                  <div className="track-menu-sep" role="separator" />
                  {moreItem('link', t('issueLinks.add'), () => {
                    close();
                    setLinksSignal((n) => n + 1);
                  }, undefined, { testId: 'track-tool-link' })}
                  {moreItem('request', tx('tools.request'), () => {
                    close();
                    setRequestSignal((n) => n + 1);
                  }, undefined, { testId: 'track-tool-request' })}
                  {moreItem('summary', tx('tools.summarize'), () => {
                    close();
                    setSummarizeSignal((n) => n + 1);
                  }, undefined, { testId: 'track-tool-summarize' })}
                </>
              )}
            </Popover>
          </div>

          <SubIssues
            parent={issue}
            store={childStore}
            project={project}
            ui={ui}
            composerSignal={composerSignal}
            onCreate={createSubIssue}
            onAddExisting={() => openCommandMenu('add-sub')}
            hideEmpty
          />

          {(attachmentError || childStore.error) && (
            <p className="ui-error" role="alert">
              {attachmentError ?? childStore.error}
            </p>
          )}

          <IssueGithubPanel data={github} />
          <IssueLinksPanel issueId={issue.id} hideEmpty addSignal={linksSignal} />

          {attachments.length > 0 && (
            <section className="track-detail-section track-issue-block">
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

          {relations.length > 0 && (
            <section className="track-detail-section track-issue-block" data-testid="track-relations">
              <h2 className="track-section-title">{labels.relations.title}</h2>
              <ul className="track-relation-list">
                {[...outgoing.map((r) => ({ r, dir: 'outgoing' as const, target: r.related_issue_id })), ...incoming.map((r) => ({ r, dir: 'incoming' as const, target: r.issue_id }))].map(
                  ({ r, dir, target }) => (
                    <li key={r.id} className="track-relation">
                      <span className="track-relation-type">{relationLabel(r.type, dir)}</span>
                      <Link href={`/app/track/issues/${target}`} className="track-relation-link">
                        <span className="track-identifier">{r.identifier}</span> <span className="track-relation-title">{r.title}</span>
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm track-relation-remove"
                        onClick={() => handleDeleteRelation(r.id)}
                        aria-label={`${labels.relations.remove}: ${r.identifier}`}
                        title={labels.relations.remove}
                      >
                        <TrackIcon name="close" size={12} />
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}

          {/* Triage e IA (T3): resumen, pedidos de clientes y sesión del agente (solo si tienen algo). */}
          <IssueMainExtras
            issueId={issue.id}
            locale={locale}
            onIssueChange={() => void handleIssueChange()}
            hideEmpty
            summarizeSignal={summarizeSignal}
            requestSignal={requestSignal}
          />

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
              onCreateSubIssue={(title) => {
                void createSubIssue(title).then(() => pushNotice(tx('sub.createdFromComment', { title })));
              }}
            />
          </section>
        </div>

        <aside className="track-detail-side" aria-label={tx('props.properties')}>
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
