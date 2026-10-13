'use client';

import { useEffect, useRef, useState } from 'react';
import { findOpenStatus, parseQuickTitle, type IssuePriority } from '@/lib/track-tasks';
import type { IssueDraft, ProjectContext } from './useIssueStore';
import type { TrackUiLabels } from './ui-labels';

export interface QuickIssueDefaults {
  projectId?: string;
  statusId?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
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

function QuickIssueModalBody({ onClose, projects, defaults, onCreate, labels, today }: QuickIssueModalProps) {
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
    if (assigneeId && !p?.members.some((m) => m.id === assigneeId)) setAssigneeId('');
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
            {projects.length > 1 ? (
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
            <span id="track-qc-title" className="track-qc-crumb">
              {labels.modal.title}
            </span>
          </div>

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
            <label className="track-qc-prop">
              <span>{labels.modal.dueDate}</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>

          <div className="track-qc-foot">
            <span className="track-qc-hint mono">{labels.quick.hint}</span>
            <label className="track-qc-more">
              <input type="checkbox" checked={createMore} onChange={(e) => setCreateMore(e.target.checked)} />
              {labels.modal.createMore}
            </label>
            <button type="button" className="btn btn-small" onClick={onClose}>
              {labels.modal.cancel}
            </button>
            <button
              type="submit"
              className="btn btn-small btn-solid"
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
