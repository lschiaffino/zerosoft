'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { TrackIssueTemplateRow } from '@/lib/db';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { openCommandMenu, setCommandContext, type CommandAction } from '@/lib/cmdk-context';
import {
  activeCycle,
  defaultIssueStatus,
  formatDay,
  parseQuickTitle,
  type IssuePatch,
  type IssuePriority,
} from '@/lib/track-tasks';
import { safeHexColor } from '@/lib/track-color';
import type { IssueDraft, ProjectContext } from './useIssueStore';
import { Popover, PriorityIcon, StatusDot } from './InlineEditors';
import RichEditor from './RichEditor';
import TrackIcon from './TrackIcon';
import { buildIssueActions } from './trackCommands';
import { pushNotice } from './trackUndo';
import type { TrackUiLabels } from './ui-labels';

export interface QuickIssueDefaults {
  projectId?: string;
  statusId?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  /** Prioridad del grupo desde el que se crea ("+" en un grupo por prioridad). */
  priority?: IssuePriority;
  /** Crea un sub-issue de este padre (el proyecto queda fijo). */
  parentId?: string | null;
  /** Texto del padre para el breadcrumb (p. ej. "TRK-12"). */
  parentLabel?: string;
  /** Prellenado (p. ej. "Crear sub-issue desde el comentario"). */
  title?: string;
  description?: string;
}

interface QuickIssueModalProps {
  open: boolean;
  onClose: () => void;
  projects: ProjectContext[];
  defaults?: QuickIssueDefaults;
  /** Crea el issue de forma optimista (los errores los muestra la vista). */
  /** Si devuelve el issue creado, los adjuntos del composer se suben a ese issue. */
  onCreate: (projectId: string, draft: IssueDraft) => void | Promise<{ id: string } | null | undefined | void>;
  labels: TrackUiLabels;
  today: string;
  /** Quién crea (para "Asignarme"). */
  meId?: string;
}

/**
 * Composer de issues como el de Linear: team arriba, título, descripción y
 * una fila de chips compactos con íconos (Status, Priority, Assignee, Labels,
 * Project, Cycle, Estimate, Due y "…" con padre, milestone, inicio y
 * plantilla). Cada chip abre el mismo menú que los atajos (filtro tipeado,
 * flechas, Enter, dígitos y crear en línea). Enter o ⌘↵ crea; Esc cierra y
 * guarda el borrador, que vuelve al abrir otra vez.
 */
export default function QuickIssueModal(props: QuickIssueModalProps) {
  if (!props.open) return null;
  return <QuickIssueModalBody {...props} />;
}

function parseTemplateLabels(raw: string): Array<{ id: string; name: string; color: string }> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.id === 'string') : [];
  } catch {
    return [];
  }
}

interface DraftState {
  projectId: string;
  parentId: string | null;
  title: string;
  description: string;
  statusId: string;
  priority: IssuePriority;
  assigneeId: string;
  dueDate: string;
  startDate: string;
  cycleId: string;
  milestoneId: string;
  estimate: number | null;
  labels: Array<{ id: string; name: string; color: string }>;
  planId: string;
  planName: string;
  /** Status "Triage": entra a la cola de triage del team. */
  triage?: boolean;
  parentLabel: string;
}

const DRAFT_KEY = 'track:composer-draft';

function readDraft(): DraftState | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as DraftState) : null;
  } catch {
    return null;
  }
}
function writeDraft(d: DraftState | null): void {
  try {
    if (d) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Sin storage: el borrador vive mientras el modal está abierto.
  }
}

const COMPOSER_PAGES = new Set(['status', 'priority', 'assignee', 'assign-me', 'labels', 'estimate', 'due', 'start', 'cycle', 'milestone', 'project', 'parent']);

function initial(name: string | null | undefined): string {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?';
}

function QuickIssueModalBody({ onClose, projects, defaults, onCreate, labels, today, meId }: QuickIssueModalProps) {
  const lang = useLocale();
  const t = useTranslations('track');
  const tq = useTranslations('track.quick');
  const tc = useTranslations('track.ux.cmd');
  const fixedParent = defaults?.parentId ?? null;

  const fresh = useCallback(
    (p: ProjectContext | undefined): DraftState => ({
      projectId: p?.id ?? '',
      parentId: fixedParent,
      title: defaults?.title ?? '',
      description: defaults?.description ?? '',
      statusId:
        (defaults?.statusId && p?.statuses.some((s) => s.id === defaults.statusId) ? defaults.statusId : undefined) ??
        (p ? defaultIssueStatus(p.statuses)?.id : undefined) ??
        '',
      // Como Linear: sin prioridad salvo que se cree desde un grupo de prioridad.
      priority: defaults?.priority ?? 'none',
      assigneeId: defaults?.assigneeId ?? '',
      dueDate: defaults?.dueDate ?? '',
      startDate: '',
      // El ciclo arranca en el activo del proyecto (si hay), como en Linear.
      cycleId: fixedParent ? '' : p?.cycles ? (activeCycle(p.cycles, today)?.id ?? '') : '',
      milestoneId: '',
      estimate: null,
      labels: [],
      planId: '',
      planName: '',
      parentLabel: defaults?.parentLabel ?? '',
    }),
    [defaults, fixedParent, today],
  );

  const initialProject = projects.find((p) => p.id === defaults?.projectId) ?? projects[0];
  const [restored, setRestored] = useState(false);
  const [d, setD] = useState<DraftState>(() => fresh(initialProject));
  const dRef = useRef(d);
  dRef.current = d;
  const project = projects.find((p) => p.id === d.projectId);
  const [templateId, setTemplateId] = useState('');
  const [createMore, setCreateMore] = useState(false);
  // Adjuntos del composer (clip, como Linear): se suben al crear.
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFiles = (list: File[]) => setAttachments((cur) => [...cur, ...list.filter((f) => f.size <= 10 * 1024 * 1024)].slice(0, 10));
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Remonta el editor de la descripción cuando cambia desde afuera (borrador, plantilla).
  const [descKey, setDescKey] = useState(0);

  // Borrador guardado (Esc lo conserva, como Linear): vuelve si es del mismo contexto.
  useEffect(() => {
    const saved = readDraft();
    if (!saved || (saved.parentId ?? null) !== fixedParent) return;
    if (!projects.some((p) => p.id === saved.projectId)) return;
    if (!saved.title.trim() && !saved.description.trim()) return;
    setD(saved);
    setRestored(true);
    setDescKey((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plantillas: las trae la vista o se piden al abrir (una vez por proyecto).
  const [fetchedTemplates, setFetchedTemplates] = useState<Record<string, TrackIssueTemplateRow[]>>({});
  const templates = useMemo(() => project?.templates ?? fetchedTemplates[d.projectId] ?? [], [project?.templates, fetchedTemplates, d.projectId]);
  useEffect(() => {
    const pid = d.projectId;
    if (!pid || project?.templates || fetchedTemplates[pid]) return;
    let alive = true;
    void fetch(`/api/track/projects/${pid}/templates`)
      .then((res) => (res.ok ? (res.json() as Promise<{ rows: TrackIssueTemplateRow[] }>) : null))
      .then((data) => {
        if (alive && data) setFetchedTemplates((prev) => ({ ...prev, [pid]: data.rows }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [d.projectId, project?.templates, fetchedTemplates]);

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      returnFocus.current?.focus?.();
    };
  }, []);

  const set = (patch: Partial<DraftState>) => setD((cur) => ({ ...cur, ...patch }));

  // Esc cierra aunque el foco haya quedado afuera (p. ej. después de un menú de ⌘K).
  const closeRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.cmdk')) return;
      if (dialogRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changeProject = useCallback(
    (id: string) => {
      const p = projects.find((x) => x.id === id);
      setD((cur) => ({
        ...fresh(p),
        title: cur.title,
        description: cur.description,
        priority: cur.priority,
        labels: cur.labels,
        planId: cur.planId,
        planName: cur.planName,
        dueDate: cur.dueDate,
        startDate: cur.startDate,
        estimate: cur.estimate,
        assigneeId: cur.assigneeId && p?.members.some((m) => m.id === cur.assigneeId) ? cur.assigneeId : '',
      }));
      setTemplateId('');
    },
    [projects, fresh],
  );

  // Aplicar una plantilla: precarga lo que tenga definido (el título y la
  // descripción solo si todavía están vacíos, para no pisar lo tipeado).
  const applyTemplate = useCallback(
    (id: string) => {
      setTemplateId(id);
      const tpl = templates.find((x) => x.id === id);
      if (!tpl) return;
      setD((cur) => ({
        ...cur,
        title: tpl.title && !cur.title.trim() ? tpl.title : cur.title,
        description: tpl.description && !cur.description.trim() ? tpl.description : cur.description,
        statusId: tpl.status_id && project?.statuses.some((s) => s.id === tpl.status_id) ? tpl.status_id : cur.statusId,
        priority: tpl.priority ?? cur.priority,
        assigneeId: tpl.assignee_id && project?.members.some((m) => m.id === tpl.assignee_id) ? tpl.assignee_id : cur.assigneeId,
        estimate: tpl.estimate ?? cur.estimate,
        labels: parseTemplateLabels(tpl.labels),
      }));
      setDescKey((n) => n + 1);
    },
    [templates, project],
  );

  // El borrador como un issue (para reusar los mismos menús de ⌘K que los atajos).
  const draftIssue = useMemo((): TrackIssueWithStatus => {
    const st = project?.statuses.find((s) => s.id === d.statusId);
    const m = project?.members.find((x) => x.id === d.assigneeId);
    return {
      id: 'draft',
      project_id: d.projectId,
      identifier: '',
      title: d.title,
      description: '[]',
      status_id: d.statusId || null,
      priority: d.priority,
      assignee_id: d.assigneeId || null,
      creator_id: meId ?? '',
      estimate: d.estimate,
      parent_id: d.parentId,
      start_date: d.startDate || null,
      due_date: d.dueDate || null,
      labels: JSON.stringify(d.labels),
      created_at: '',
      updated_at: '',
      status_name: st?.name ?? null,
      status_color: st?.color ?? null,
      status_category: st?.category ?? null,
      assignee_name: m?.name ?? null,
      assignee_email: m?.email ?? null,
      cycle_id: d.cycleId || null,
      cycle_name: null,
      milestone_id: d.milestoneId || null,
      plan_id: d.planId || null,
      child_count: 0,
    } as TrackIssueWithStatus;
  }, [d, project, meId]);
  const draftRef = useRef(draftIssue);
  draftRef.current = draftIssue;

  const applyPatch = useCallback((patch: IssuePatch) => {
    const next: Partial<DraftState> = {};
    if (patch.statusId !== undefined) {
      next.statusId = patch.statusId ?? '';
      next.triage = false;
    }
    if (patch.priority !== undefined) next.priority = patch.priority;
    if (patch.assigneeId !== undefined) next.assigneeId = patch.assigneeId ?? '';
    if (patch.dueDate !== undefined) next.dueDate = patch.dueDate ?? '';
    if (patch.startDate !== undefined) next.startDate = patch.startDate ?? '';
    if (patch.cycleId !== undefined) next.cycleId = patch.cycleId ?? '';
    if (patch.milestoneId !== undefined) next.milestoneId = patch.milestoneId ?? '';
    if (patch.estimate !== undefined) next.estimate = patch.estimate;
    if (patch.labels !== undefined) {
      next.labels = patch.labels.map((l) => ({
        id: l.id,
        name: 'name' in l && typeof l.name === 'string' ? l.name : '',
        color: 'color' in l && typeof l.color === 'string' ? l.color : '#767676',
      }));
    }
    if (patch.planId !== undefined) {
      next.planId = patch.planId ?? '';
      next.planName = '';
      if (patch.planId) {
        const pid = patch.planId;
        void fetch(`/api/track/plans/${pid}`)
          .then((res) => (res.ok ? (res.json() as Promise<{ name?: string; plan?: { name?: string } }>) : null))
          .then((data) => {
            const name = data?.name ?? data?.plan?.name ?? '';
            setD((cur) => (cur.planId === pid ? { ...cur, planName: name } : cur));
          })
          .catch(() => undefined);
      }
    }
    if (patch.parentId !== undefined) {
      next.parentId = patch.parentId ?? null;
      next.parentLabel = '';
      if (patch.parentId) {
        const pid = patch.parentId;
        void fetch(`/api/track/issues/${pid}`)
          .then((res) => (res.ok ? (res.json() as Promise<{ identifier: string }>) : null))
          .then((data) => {
            if (data) setD((cur) => (cur.parentId === pid ? { ...cur, parentLabel: data.identifier } : cur));
          })
          .catch(() => undefined);
      }
    }
    setD((cur) => ({ ...cur, ...next }));
  }, []);

  // Teams con triage activo (para ofrecer "Triage" en el estado).
  const [triageTeams, setTriageTeams] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const pid = d.projectId;
    if (!pid || pid in triageTeams) return;
    let alive = true;
    void fetch(`/api/track/projects/${pid}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ triage_enabled?: number; project?: { triage_enabled?: number } }>) : null))
      .then((row) => {
        if (!alive) return;
        const on = Boolean(row?.triage_enabled ?? row?.project?.triage_enabled);
        setTriageTeams((m) => ({ ...m, [pid]: on }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [d.projectId, triageTeams]);

  // Mientras el composer está abierto, ⌘K y los chips operan sobre el borrador.
  useEffect(() => {
    const build = () => {
      const cur = dRef.current;
      const p = projects.find((x) => x.id === cur.projectId);
      if (!p) return null;
      const data = {
        statuses: p.statuses.map((s) => ({ ...s, project_id: p.id })),
        members: p.members,
        labels: p.labels ?? [],
        cycles: p.cycles ?? [],
        milestones: p.milestones ?? [],
        priorities: labels.priorities,
        meId: meId ?? '',
        today,
      };
      const actions = buildIssueActions(
        [draftRef.current],
        data,
        { apply: (_targets, patch) => applyPatch(typeof patch === 'function' ? patch(draftRef.current) : patch) },
        (k, v) => tc(k, v),
        (iso) => formatDay(iso, lang, today),
      )
        .filter((a) => COMPOSER_PAGES.has(a.id) && (a.id !== 'assign-me' || Boolean(meId)))
        .map((a) => {
          // Team con triage: "Triage" como primera opción del estado (como el composer de Linear).
          if (a.id !== 'status' || !triageTeams[cur.projectId] || !a.children) return a;
          const base = a.children;
          return {
            ...a,
            children: () => [
              {
                id: 'status:triage',
                label: tq('triage'),
                icon: { kind: 'glyph' as const, name: 'duplicate' as const },
                checked: Boolean(dRef.current.triage),
                run: () => setD((c) => ({ ...c, triage: true })),
              },
              ...base().map((o) => ({ ...o, checked: o.checked && !dRef.current.triage })),
            ],
          };
        });
      const extra: CommandAction[] = [];
      if (projects.length > 1 && !fixedParent) {
        extra.push({
          id: 'team',
          label: labels.modal.project,
          keywords: 'team equipo equipe',
          placeholder: tc('searchTeam'),
          icon: { kind: 'glyph', name: 'team' },
          children: () =>
            projects.map((x) => ({
              id: `team:${x.id}`,
              label: x.name,
              checked: x.id === cur.projectId,
              run: () => changeProject(x.id),
            })),
        });
      }
      if (templates.length > 0) {
        extra.push({
          id: 'template',
          label: t('templates.pick'),
          keywords: 'template plantilla modelo',
          placeholder: t('templates.pick'),
          children: () => [
            { id: 'template:none', label: t('templates.none'), isNone: true, checked: !templateId, run: () => setTemplateId('') },
            ...templates.map((tpl) => ({ id: `template:${tpl.id}`, label: tpl.name, checked: tpl.id === templateId, run: () => applyTemplate(tpl.id) })),
          ],
        });
      }
      return { title: cur.parentLabel ? labels.modal.subTitle : labels.modal.title, actions: [...actions, ...extra] };
    };
    return setCommandContext(build);
  }, [projects, labels, meId, today, tc, tq, lang, applyPatch, fixedParent, changeProject, templates, templateId, applyTemplate, t, triageTeams]);

  const close = () => {
    // Esc o clic afuera: el borrador queda guardado (como Linear).
    const cur = dRef.current;
    writeDraft(cur.title.trim() || cur.description.trim() ? cur : null);
    onClose();
  };

  closeRef.current = close;

  const discard = () => {
    writeDraft(null);
    setD(fresh(initialProject));
    setTemplateId('');
    setRestored(false);
    setDescKey((n) => n + 1);
    titleRef.current?.focus();
  };

  // ⌘⇧↵ crea y vuelve a abrir con las mismas propiedades (como Linear).
  const submit = (keep = false) => {
    if (!d.projectId) return;
    // Los tokens (!high, @tomorrow) también funcionan acá; los campos
    // elegidos a mano tienen prioridad solo si el token no aparece.
    const parsed = parseQuickTitle(d.title, today);
    if (!parsed.title) return;
    const files = attachments;
    setAttachments([]);
    const created = onCreate(d.projectId, {
      title: parsed.title,
      description: d.description,
      statusId: d.statusId || undefined,
      priority: parsed.priority ?? d.priority,
      assigneeId: d.assigneeId || null,
      dueDate: parsed.dueDate ?? (d.dueDate || null),
      startDate: d.startDate || null,
      parentId: d.parentId ?? null,
      // En triage no entra a ningún cycle (como Linear: se planifica al aceptarlo).
      cycleId: d.triage ? null : d.cycleId || null,
      milestoneId: d.milestoneId || null,
      estimate: d.estimate,
      planId: d.planId || null,
      labels: d.labels.map((l) => ({ id: l.id })),
      triage: d.triage || undefined,
    });
    // Adjuntos elegidos con el clip: se suben al issue cuando existe.
    if (files.length && created && typeof (created as Promise<unknown>).then === 'function') {
      void (created as Promise<{ id: string } | null | undefined | void>).then(async (issue) => {
        if (!issue || !('id' in issue)) return;
        for (const file of files) {
          const form = new FormData();
          form.append('file', file);
          await fetch(`/api/track/issues/${issue.id}/attachments`, { method: 'POST', body: form }).catch(() => null);
        }
      });
    }
    writeDraft(null);
    setRestored(false);
    if (createMore || keep) {
      set({ title: '', description: '' });
      setDescKey((n) => n + 1);
      // Después del remonte del editor, el foco vuelve al título.
      window.setTimeout(() => titleRef.current?.focus(), 0);
      if (keep) pushNotice(tq('createdKeep'));
    } else {
      onClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit(e.shiftKey);
      return;
    }
    // Trap de foco simple dentro del diálogo.
    if (e.key === 'Tab' && dialogRef.current) {
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('input, textarea, [contenteditable="true"], button:not([disabled])'),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const chip = (page: string, label: string, icon: React.ReactNode, text: React.ReactNode, empty: boolean, testId?: string) => (
    <button
      type="button"
      className={`track-qc-chip${empty ? ' is-empty' : ''}`}
      data-cmd-anchor={page}
      aria-label={`${label}: ${typeof text === 'string' ? text : ''}`.replace(/: $/, '')}
      title={label}
      data-testid={testId}
      onClick={(e) => openCommandMenu(page, { anchor: e.currentTarget })}
    >
      <span className="track-qc-chip-icon" aria-hidden>
        {icon}
      </span>
      <span className="track-qc-chip-text">{text}</span>
    </button>
  );

  const status = project?.statuses.find((s) => s.id === d.statusId);
  const member = project?.members.find((m) => m.id === d.assigneeId);
  const cycle = project?.cycles?.find((c) => c.id === d.cycleId);
  const milestone = project?.milestones?.find((m) => m.id === d.milestoneId);
  const prioLabel = d.priority === 'none' ? labels.modal.priority : (labels.priorities.find((p) => p.value === d.priority)?.label ?? d.priority);
  const template = templates.find((x) => x.id === templateId);

  return (
    <div className="track-dialog-overlay track-qc-overlay" onMouseDown={close}>
      <div
        ref={dialogRef}
        className="track-qc"
        role="dialog"
        aria-modal="true"
        aria-labelledby="track-qc-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        // Pegar o soltar archivos los suma como adjuntos (se suben al crear).
        onPasteCapture={(e) => {
          const files = Array.from(e.clipboardData?.files ?? []);
          if (!files.length) return;
          e.preventDefault();
          e.stopPropagation();
          addFiles(files);
        }}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
        }}
        onDropCapture={(e) => {
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (!files.length) return;
          e.preventDefault();
          e.stopPropagation();
          addFiles(files);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="track-qc-head">
            {projects.length > 1 && !fixedParent ? (
              <button
                type="button"
                className="track-qc-team"
                data-cmd-anchor="team"
                aria-label={`${labels.modal.project}: ${project?.name ?? ''}`}
                onClick={(e) => openCommandMenu('team', { anchor: e.currentTarget })}
                data-testid="track-qc-team"
              >
                <span className="track-qc-team-name">
                  {project?.icon ? `${project.icon} ` : ''}
                  {project?.name}
                </span>
                <TrackIcon name="chevronDown" size={12} />
              </button>
            ) : (
              <span className="track-qc-crumb">{project?.name}</span>
            )}
            <span className="track-qc-sep" aria-hidden>
              ›
            </span>
            {d.parentLabel && (
              <>
                <span className="track-qc-crumb track-identifier">{d.parentLabel}</span>
                <span className="track-qc-sep" aria-hidden>
                  ›
                </span>
              </>
            )}
            <span id="track-qc-title" className="track-qc-crumb">
              {d.parentId ? labels.modal.subTitle : labels.modal.title}
            </span>
            {restored && (
              <span className="track-qc-draft" role="status">
                {tq('draftRestored')}
                <button type="button" className="track-qc-discard" onClick={discard} data-testid="track-qc-discard">
                  {tq('discard')}
                </button>
              </span>
            )}
            <button type="button" className="btn btn-ghost btn-icon track-qc-close" onClick={close} aria-label={tq('close')} title={tq('close')}>
              <TrackIcon name="close" size={14} />
            </button>
          </div>

          <input
            ref={titleRef}
            className="track-qc-title"
            type="text"
            value={d.title}
            maxLength={500}
            onChange={(e) => set({ title: e.target.value })}
            placeholder={labels.modal.titlePlaceholder}
            aria-label={labels.modal.titlePlaceholder}
          />
          <RichEditor
            key={descKey}
            className="track-qc-desc"
            value={d.description}
            onChange={(md) => set({ description: md })}
            placeholder={labels.modal.descriptionPlaceholder}
            ariaLabel={labels.modal.descriptionPlaceholder}
            members={project?.members}
            compact
            onSubmit={() => submit()}
            onEscape={close}
          />

          <div className="track-qc-chips" role="group" aria-label={tq('properties')} data-testid="track-qc-chips">
            {d.triage
              ? chip('status', labels.modal.status, <TrackIcon name="views" size={14} />, tq('triage'), false, 'track-qc-status')
              : chip('status', labels.modal.status, <StatusDot color={status?.color ?? null} category={status?.category ?? 'todo'} />, status?.name ?? labels.modal.status, !status, 'track-qc-status')}
            {chip('priority', labels.modal.priority, <PriorityIcon priority={d.priority} />, prioLabel, d.priority === 'none', 'track-qc-priority')}
            {chip(
              'assignee',
              labels.modal.assignee,
              member ? <span className="track-avatar is-small">{initial(member.name || member.email)}</span> : <span className="track-avatar is-small track-avatar-empty" />,
              member ? member.name || member.email : labels.modal.assignee,
              !member,
              'track-qc-assignee',
            )}
            {chip(
              'labels',
              tq('chip.labels'),
              d.labels.length ? (
                <span className="track-qc-dots">
                  {d.labels.slice(0, 3).map((l) => (
                    <span key={l.id} className="track-label-dot" style={{ background: safeHexColor(l.color, '#767676') }} />
                  ))}
                </span>
              ) : (
                <TrackIcon name="tag" size={14} />
              ),
              d.labels.length === 0 ? tq('chip.labels') : d.labels.length === 1 ? d.labels[0].name : tq('chip.labelCount', { count: d.labels.length }),
              d.labels.length === 0,
              'track-qc-labels',
            )}
            {chip('project', tq('chip.project'), <TrackIcon name="plans" size={14} />, d.planId ? d.planName || '…' : tq('chip.project'), !d.planId, 'track-qc-project')}
            {project?.cycles && project.cycles.length > 0 &&
              chip('cycle', labels.modal.cycle, <TrackIcon name="cycle" size={14} />, cycle?.name ?? labels.modal.cycle, !cycle, 'track-qc-cycle')}
            {chip(
              'estimate',
              tq('chip.estimate'),
              <TrackIcon name="estimate" size={14} />,
              d.estimate == null ? tq('chip.estimate') : tc('points', { count: d.estimate }),
              d.estimate == null,
              'track-qc-estimate',
            )}
            {chip(
              'due',
              labels.modal.dueDate,
              <TrackIcon name="calendar" size={14} />,
              d.dueDate ? formatDay(d.dueDate, lang, today) : labels.modal.dueDate,
              !d.dueDate,
              'track-qc-due',
            )}
            {(d.startDate || milestone || template) && (
              <span className="track-qc-extra">
                {d.startDate && chip('start', t('issues.startDate'), <TrackIcon name="calendar" size={14} />, formatDay(d.startDate, lang, today), false)}
                {milestone && chip('milestone', t('milestones.property'), <TrackIcon name="flag" size={14} />, milestone.name, false)}
                {template && chip('template', t('templates.pick'), <TrackIcon name="views" size={14} />, template.name, false, 'track-qc-template')}
              </span>
            )}
            <button
              type="button"
              className="track-qc-chip is-icon"
              aria-label={tq('attach')}
              title={tq('attach')}
              onClick={() => fileRef.current?.click()}
              data-testid="track-qc-attach"
            >
              <TrackIcon name="paperclip" size={14} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              data-testid="track-qc-file"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.currentTarget.value = '';
              }}
            />
            {attachments.map((f, i) => (
              <span key={`${f.name}-${i}`} className="track-qc-chip track-qc-file" data-testid="track-qc-attachment">
                <span className="track-qc-chip-text">{f.name}</span>
                <button
                  type="button"
                  className="track-qc-file-remove"
                  aria-label={tq('removeAttachment', { name: f.name })}
                  onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                >
                  <TrackIcon name="close" size={10} />
                </button>
              </span>
            ))}
            <Popover ariaLabel={tq('chip.more')} className="track-qc-chip is-icon" width={220} trigger={<TrackIcon name="more" size={14} />}>
              {(closeMenu) => (
                <>
                  {[
                    { page: 'parent', label: tc('setParent'), show: !fixedParent },
                    { page: 'start', label: tc('start'), show: true },
                    { page: 'milestone', label: tc('milestone'), show: Boolean(project?.milestones?.length) },
                    { page: 'template', label: t('templates.pick'), show: templates.length > 0 },
                  ]
                    .filter((x) => x.show)
                    .map((x, i) => (
                      <button
                        key={x.page}
                        type="button"
                        role="menuitem"
                        className="track-menu-item"
                        data-autofocus={i === 0 ? '' : undefined}
                        onClick={() => {
                          closeMenu();
                          const anchor = dialogRef.current?.querySelector('.track-qc-chips');
                          window.setTimeout(() => openCommandMenu(x.page, { anchor }), 0);
                        }}
                      >
                        <span className="track-menu-label">{x.label}</span>
                      </button>
                    ))}
                </>
              )}
            </Popover>
          </div>

          <div className="track-qc-foot">
            <span className="track-qc-hint">{labels.quick.hint}</span>
            <label className="ui-check track-qc-more">
              <input type="checkbox" checked={createMore} onChange={(e) => setCreateMore(e.target.checked)} />
              {labels.modal.createMore}
            </label>
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              disabled={!d.title.trim() || !d.projectId}
              title={labels.modal.submitHint}
              data-testid="track-qc-create"
            >
              {labels.modal.create}
              <kbd className="track-qc-kbd" aria-hidden>
                ⌘↵
              </kbd>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
