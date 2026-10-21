'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { TrackIssueTemplateRow } from '@/lib/db';
import { activeCycle, findOpenStatus, parseQuickTitle, type IssuePriority } from '@/lib/track-tasks';
import type { IssueDraft, ProjectContext } from './useIssueStore';
import { DueDateMenu } from './InlineEditors';
import { safeHexColor } from '@/lib/track-color';
import type { TrackUiLabels } from './ui-labels';

export interface QuickIssueDefaults {
  projectId?: string;
  statusId?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  /** Crea un sub-issue de este padre (el proyecto queda fijo). */
  parentId?: string | null;
  /** Texto del padre para el breadcrumb (p. ej. "TRK-12"). */
  parentLabel?: string;
}

interface QuickIssueModalProps {
  open: boolean;
  onClose: () => void;
  projects: ProjectContext[];
  defaults?: QuickIssueDefaults;
  /** Crea el issue de forma optimista (los errores los muestra la vista). */
  onCreate: (projectId: string, draft: IssueDraft) => void;
  labels: TrackUiLabels;
  today: string;
}

/**
 * Modal liviano para crear un issue sin salir de la vista: título,
 * descripción opcional y las propiedades principales. Enter (o Cmd/Ctrl+Enter
 * desde la descripción) crea; Esc cierra.
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

function QuickIssueModalBody({ onClose, projects, defaults, onCreate, labels, today }: QuickIssueModalProps) {
  const lang = useLocale();
  const t = useTranslations('track');
  const initialProject = projects.find((p) => p.id === defaults?.projectId) ?? projects[0];
  const [projectId, setProjectId] = useState(initialProject?.id ?? '');
  const project = projects.find((p) => p.id === projectId);
  const defaultStatus = (p: ProjectContext | undefined) =>
    (defaults?.statusId && p?.statuses.some((s) => s.id === defaults.statusId) ? defaults.statusId : undefined) ??
    (p ? findOpenStatus(p.statuses)?.id : undefined) ??
    '';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [statusId, setStatusId] = useState(() => defaultStatus(initialProject));
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [assigneeId, setAssigneeId] = useState(defaults?.assigneeId ?? '');
  const [dueDate, setDueDate] = useState(defaults?.dueDate ?? '');
  // El ciclo arranca en el activo del proyecto (si hay), como en Linear.
  const defaultCycle = (p: ProjectContext | undefined) => (p?.cycles ? (activeCycle(p.cycles, today)?.id ?? '') : '');
  const [cycleId, setCycleId] = useState(() => (defaults?.parentId ? '' : defaultCycle(initialProject)));
  const [milestoneId, setMilestoneId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [presetLabels, setPresetLabels] = useState<Array<{ id: string; name: string; color: string }>>([]);
  // Plantillas: las trae la vista o se piden al abrir (una vez por proyecto).
  const [fetchedTemplates, setFetchedTemplates] = useState<Record<string, TrackIssueTemplateRow[]>>({});
  const templates = project?.templates ?? fetchedTemplates[projectId] ?? [];
  useEffect(() => {
    if (!projectId || project?.templates || fetchedTemplates[projectId]) return;
    let alive = true;
    void fetch(`/api/track/projects/${projectId}/templates`)
      .then((res) => (res.ok ? (res.json() as Promise<{ rows: TrackIssueTemplateRow[] }>) : null))
      .then((data) => {
        if (alive && data) setFetchedTemplates((prev) => ({ ...prev, [projectId]: data.rows }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId, project?.templates, fetchedTemplates]);
  const [createMore, setCreateMore] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

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

  const changeProject = (id: string) => {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    setStatusId(defaultStatus(p));
    setCycleId(defaultCycle(p));
    if (assigneeId && !p?.members.some((m) => m.id === assigneeId)) setAssigneeId('');
    setMilestoneId('');
    setTemplateId('');
    setEstimate(null);
    setPresetLabels([]);
  };

  // Aplicar una plantilla: precarga lo que tenga definido (el título y la
  // descripción solo si todavía están vacíos, para no pisar lo tipeado).
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) {
      setEstimate(null);
      setPresetLabels([]);
      return;
    }
    if (tpl.title && !title.trim()) setTitle(tpl.title);
    if (tpl.description && !description.trim()) setDescription(tpl.description);
    if (tpl.status_id && project?.statuses.some((s) => s.id === tpl.status_id)) setStatusId(tpl.status_id);
    if (tpl.priority) setPriority(tpl.priority);
    if (tpl.assignee_id && project?.members.some((m) => m.id === tpl.assignee_id)) setAssigneeId(tpl.assignee_id);
    setEstimate(tpl.estimate ?? null);
    setPresetLabels(parseTemplateLabels(tpl.labels));
  };

  const submit = () => {
    if (!projectId) return;
    // Los tokens (!high, @tomorrow) también funcionan acá; los campos
    // elegidos a mano tienen prioridad solo si el token no aparece.
    const parsed = parseQuickTitle(title, today);
    if (!parsed.title) return;
    onCreate(projectId, {
      title: parsed.title,
      description,
      statusId: statusId || undefined,
      priority: parsed.priority ?? priority,
      assigneeId: assigneeId || null,
      dueDate: parsed.dueDate ?? (dueDate || null),
      parentId: defaults?.parentId ?? null,
      cycleId: cycleId || null,
      milestoneId: milestoneId || null,
      estimate,
      labels: presetLabels.map((l) => ({ id: l.id })),
    });
    if (createMore) {
      setTitle('');
      setDescription('');
      titleRef.current?.focus();
    } else {
      onClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      return;
    }
    // Trap de foco simple dentro del diálogo.
    if (e.key === 'Tab' && dialogRef.current) {
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('input, textarea, select, button:not([disabled])'),
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

  return (
    <div className="track-dialog-overlay track-qc-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="track-qc"
        role="dialog"
        aria-modal="true"
        aria-labelledby="track-qc-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="track-qc-head">
            {projects.length > 1 && !defaults?.parentId ? (
              <select
                className="track-qc-project"
                aria-label={labels.modal.project}
                value={projectId}
                onChange={(e) => changeProject(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.icon ? `${p.icon} ` : ''}
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="track-qc-crumb">{project?.name}</span>
            )}
            <span className="track-qc-sep" aria-hidden>
              ›
            </span>
            {defaults?.parentLabel && (
              <>
                <span className="track-qc-crumb track-identifier">{defaults.parentLabel}</span>
                <span className="track-qc-sep" aria-hidden>
                  ›
                </span>
              </>
            )}
            <span id="track-qc-title" className="track-qc-crumb">
              {defaults?.parentId ? labels.modal.subTitle : labels.modal.title}
            </span>
          </div>

          {templates.length > 0 && (
            <label className="track-qc-prop track-qc-template">
              <span>{t('templates.pick')}</span>
              <select value={templateId} onChange={(e) => applyTemplate(e.target.value)} data-testid="track-qc-template">
                <option value="">{t('templates.none')}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <input
            ref={titleRef}
            className="track-qc-title"
            type="text"
            value={title}
            maxLength={500}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={labels.modal.titlePlaceholder}
            aria-label={labels.modal.titlePlaceholder}
          />
          <textarea
            className="track-qc-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={labels.modal.descriptionPlaceholder}
            aria-label={labels.modal.descriptionPlaceholder}
            rows={3}
          />

          <div className="track-qc-props">
            <label className="track-qc-prop">
              <span>{labels.modal.status}</span>
              <select value={statusId} onChange={(e) => setStatusId(e.target.value)}>
                {(project?.statuses ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="track-qc-prop">
              <span>{labels.modal.priority}</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)}>
                {labels.priorities.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="track-qc-prop">
              <span>{labels.modal.assignee}</span>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">{labels.noAssignee}</option>
                {(project?.members ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </label>
            <span className="track-qc-prop">
              <span>{labels.modal.dueDate}</span>
              <DueDateMenu
                dueDate={dueDate || null}
                locale={lang}
                today={today}
                labels={labels.inline}
                onChange={(v) => setDueDate(v ?? '')}
              />
            </span>
            {project?.cycles && project.cycles.length > 0 && (
              <label className="track-qc-prop">
                <span>{labels.modal.cycle}</span>
                <select value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
                  <option value="">{labels.modal.noCycle}</option>
                  {project.cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {project?.milestones && project.milestones.length > 0 && (
              <label className="track-qc-prop">
                <span>{t('milestones.property')}</span>
                <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} data-testid="track-qc-milestone">
                  <option value="">{t('issues.none')}</option>
                  {project.milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {presetLabels.length > 0 && (
              <span className="track-label-chips track-qc-labels">
                {presetLabels.map((l) => (
                  <span key={l.id} className="track-label-tag">
                    <span className="track-label-tag-dot" style={{ background: safeHexColor(l.color, '#767676') }} aria-hidden />
                    {l.name}
                  </span>
                ))}
              </span>
            )}
          </div>

          <div className="track-qc-foot">
            <span className="track-qc-hint">{labels.quick.hint}</span>
            <label className="ui-check track-qc-more">
              <input type="checkbox" checked={createMore} onChange={(e) => setCreateMore(e.target.checked)} />
              {labels.modal.createMore}
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              {labels.modal.cancel}
            </button>
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              disabled={!title.trim() || !projectId}
              title={labels.modal.submitHint}
            >
              {labels.modal.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
