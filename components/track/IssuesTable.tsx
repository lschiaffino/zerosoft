"use client";

import { useMemo } from "react";
import IssueDemandBadges from "./triage/IssueDemandBadges";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/utils";
import type { TrackIssueWithStatus } from "@/lib/track-data";
import type { IssueLabel } from "@/lib/track-schema";
import type { IssuePatch } from "@/lib/track-tasks";
import StatusBadge from "./StatusBadge";
import EmptyState from "@/components/ui/EmptyState";
import TrackIcon from "./TrackIcon";
import {
  AssigneeMenu,
  DueDateMenu,
  PriorityIcon,
  PriorityMenu,
  QuickAdd,
  StatusMenu,
} from "./InlineEditors";
import { isPendingIssue, type ProjectMap } from "./useIssueStore";
import { nestIssues } from "@/lib/track-views";
import { ProgressRing } from "./ProgressRing";
import type { TrackUiLabels } from "./ui-labels";
import type { IssueSelection } from "./BulkEdit";

export type SortField = "identifier" | "title" | "priority" | "created" | null;

/**
 * Columnas que se pueden ocultar (Display properties). `created` está oculta
 * salvo que se pida; las etiquetas van en línea después del título.
 */
export type OptionalColumn =
  | "assignee"
  | "cycle"
  | "created"
  | "project"
  | "id"
  | "priority"
  | "labels"
  | "due";

export interface IssuesTableEditing {
  projects: ProjectMap;
  onUpdate: (issueId: string, patch: IssuePatch) => void;
  onToggleDone: (issue: TrackIssueWithStatus) => void;
  ui: TrackUiLabels;
  today: string;
}

export interface IssuesTableQuickAdd {
  onCreate: (title: string, projectId: string) => void;
  projects?: Array<{ id: string; name: string }>;
  defaultProjectId?: string;
}

interface IssuesTableProps {
  issues: TrackIssueWithStatus[];
  locale: string;
  labels: {
    identifier: string;
    title: string;
    status: string;
    priority: string;
    assignee: string;
    cycle: string;
    created: string;
    dueDate: string;
    labels: string;
    noAssignee: string;
    empty: string;
    hasSubtasks: string;
    project?: string;
  };
  sort?: SortField;
  sortDir?: "asc" | "desc";
  onSort?: (field: SortField) => void;
  /** Si está presente, las celdas se vuelven editables inline. */
  editing?: IssuesTableEditing;
  /** Fila "+ New task" al final de la lista. */
  quickAdd?: IssuesTableQuickAdd;
  hideColumns?: OptionalColumn[];
  /** Columnas opcionales que arrancan ocultas (hoy, `created`). */
  showColumns?: OptionalColumn[];
  /** Ancho fijo por columna, para que varias tablas seguidas alineen (Mis tareas). */
  fixedLayout?: boolean;
  /** Muestra la cabecera de columnas (por defecto sí). */
  showHeader?: boolean;
  /** Selección múltiple para edición masiva (checkbox, shift+clic, X). */
  selection?: IssueSelection & { label: string; allLabel: string };
  /** Sub-issues debajo de su padre (cuando el padre está en la lista). */
  nested?: boolean;
  /** Ancho (en caracteres) de la columna ID: varias tablas seguidas alinean. */
  idWidth?: number;
}

/** Caracteres del identificador más largo (ancho fijo de la columna ID, como Linear). */
export function identifierWidth(issues: Array<{ identifier: string }>): number {
  return issues.reduce((n, i) => Math.max(n, i.identifier.length), 6);
}

function parseLabels(raw: string): IssueLabel[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function IssuesTable({
  issues,
  locale,
  labels,
  sort = null,
  sortDir = "asc",
  onSort,
  editing,
  quickAdd,
  hideColumns = [],
  showColumns = [],
  fixedLayout = false,
  showHeader = true,
  selection,
  nested = false,
  idWidth,
}: IssuesTableProps) {
  const sorted = useMemo(() => {
    if (!sort) return issues;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...issues].sort((a, b) => {
      let cmp = 0;
      if (sort === "identifier") cmp = a.identifier.localeCompare(b.identifier);
      else if (sort === "title") cmp = a.title.localeCompare(b.title);
      else if (sort === "priority") {
        const order = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
        cmp = (order[a.priority] ?? 99) - (order[b.priority] ?? 99);
      } else if (sort === "created") {
        cmp =
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return cmp * dir;
    });
  }, [issues, sort, sortDir]);

  const rows = useMemo(
    () =>
      nested
        ? nestIssues(sorted)
        : sorted.map((issue) => ({ issue, depth: 0 })),
    [nested, sorted],
  );

  if (sorted.length === 0 && !quickAdd) {
    return <EmptyState quiet title={labels.empty} />;
  }

  const show = (c: OptionalColumn) =>
    !hideColumns.includes(c) &&
    (c !== "project" || Boolean(labels.project)) &&
    (c !== "created" || showColumns.includes("created"));
  const columnCount =
    (selection ? 1 : 0) +
    2 +
    (
      [
        "id",
        "priority",
        "due",
        "assignee",
        "cycle",
        "created",
        "project",
      ] as OptionalColumn[]
    ).filter(show).length;
  const idChars = idWidth ?? identifierWidth(sorted);
  // Con el mouse se suelta el foco de la casilla: X, J/K y S siguen andando.
  const releaseFocus = (e: React.MouseEvent<HTMLInputElement>) => {
    if (e.detail > 0) e.currentTarget.blur();
  };

  const header = (field: SortField, label: string, className?: string) => (
    <th
      className={
        [field && onSort ? "track-sortable" : "", className ?? ""]
          .filter(Boolean)
          .join(" ") || undefined
      }
      onClick={field && onSort ? () => onSort(field) : undefined}
      aria-sort={
        sort === field
          ? sortDir === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      {label}
      {sort === field && (
        <span className="track-sort-arrow">
          <TrackIcon name={sortDir === "asc" ? "up" : "down"} size={11} />
        </span>
      )}
    </th>
  );

  return (
    <div
      className={`table-wrap track-table-wrap${editing ? " is-editable is-linear" : ""}${selection && selection.selected.size > 0 ? " has-selection" : ""}`}
      style={{ "--track-id-ch": idChars } as React.CSSProperties}
    >
      <table className={`table track-table${fixedLayout ? " is-fixed" : ""}`}>
        {showHeader && (
          <thead>
            <tr>
              {selection && (
                <th className="track-col-select">
                  <input
                    type="checkbox"
                    className="track-select-box"
                    aria-label={selection.allLabel}
                    checked={
                      sorted.length > 0 &&
                      selection.selected.size === sorted.length
                    }
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          selection.selected.size > 0 &&
                          selection.selected.size < sorted.length;
                    }}
                    onChange={() => selection.toggleAll()}
                    onClick={releaseFocus}
                    data-testid="track-select-all"
                  />
                </th>
              )}
              {show("id") &&
                header("identifier", labels.identifier, "track-col-id")}
              {header("title", labels.title)}
              {show("project") && (
                <th className="hide-sm track-col-project">{labels.project}</th>
              )}
              <th className="track-col-status">{labels.status}</th>
              {show("priority") &&
                header(
                  "priority",
                  labels.priority,
                  "hide-sm track-col-priority",
                )}
              {show("assignee") && (
                <th className="hide-sm track-col-assignee">
                  {labels.assignee}
                </th>
              )}
              {show("cycle") && (
                <th className="hide-sm track-col-cycle">{labels.cycle}</th>
              )}
              {show("due") && (
                <th className="hide-sm track-col-due">{labels.dueDate}</th>
              )}
              {show("created") &&
                header("created", labels.created, "hide-sm track-col-created")}
            </tr>
          </thead>
        )}
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columnCount} className="track-table-empty">
                {labels.empty}
              </td>
            </tr>
          )}
          {rows.map(({ issue, depth }) => {
            const issueLabels = parseLabels(issue.labels);
            const pending = isPendingIssue(issue);
            const ctx = editing?.projects[issue.project_id];
            const completed =
              issue.status_category === "done" ||
              issue.status_category === "cancelled";
            const titleContent = (
              <>
                <span className="track-issue-title">{issue.title || "–"}</span>
                <IssueDemandBadges issue={issue} />
                {issue.child_count > 0 && (
                  <span
                    className="track-subtask-indicator"
                    title={labels.hasSubtasks}
                  >
                    <ProgressRing
                      done={issue.child_done ?? 0}
                      total={issue.child_count}
                      size={12}
                    />
                    <span className="sr-only">{labels.hasSubtasks}:</span>{" "}
                    {issue.child_done ?? 0}/{issue.child_count}
                  </span>
                )}
                {issue.parent_id && depth === 0 && issue.parent_identifier && (
                  <span
                    className="track-row-parent"
                    title={issue.parent_title ?? undefined}
                  >
                    <TrackIcon name="parent" size={11} />
                    {issue.parent_identifier}
                  </span>
                )}
                {issueLabels.length > 0 && show("labels") && (
                  <span className="track-label-chips track-title-labels">
                    <span className="sr-only">{labels.labels}:</span>
                    {issueLabels.map((l) => (
                      <span
                        key={l.id}
                        className="track-label-tag"
                        title={l.name}
                      >
                        <span
                          className="track-label-tag-dot"
                          style={{ background: l.color }}
                          aria-hidden
                        />
                        {l.name}
                      </span>
                    ))}
                  </span>
                )}
              </>
            );
            return (
              <tr
                key={issue.id}
                data-issue-row={pending ? undefined : ""}
                data-href={
                  pending ? undefined : `/app/track/issues/${issue.id}`
                }
                data-issue-id={pending || !selection ? undefined : issue.id}
                data-issue-key={pending ? undefined : issue.id}
                className={
                  [
                    pending ? "is-pending" : "",
                    editing && completed ? "is-completed" : "",
                    selection?.selected.has(issue.id) ? "is-selected" : "",
                    depth > 0 ? "is-child" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                {selection && (
                  <td className="track-col-select">
                    <input
                      type="checkbox"
                      className="track-select-box"
                      aria-label={`${selection.label} ${issue.identifier}`}
                      checked={selection.selected.has(issue.id)}
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation();
                        selection.toggle(issue.id, e.shiftKey);
                        releaseFocus(e);
                      }}
                      onChange={() => undefined}
                      data-testid="track-select-row"
                    />
                  </td>
                )}
                {show("id") && (
                  <td className="track-col-id">
                    {pending ? (
                      <span className="track-identifier">
                        {issue.identifier}
                      </span>
                    ) : (
                      <Link
                        href={`/app/track/issues/${issue.id}`}
                        tabIndex={editing ? -1 : undefined}
                      >
                        <span className="track-identifier">
                          {issue.identifier}
                        </span>
                      </Link>
                    )}
                  </td>
                )}
                <td
                  className="track-col-title"
                  style={
                    depth > 0
                      ? ({ "--depth": depth } as React.CSSProperties)
                      : undefined
                  }
                >
                  {pending ? (
                    titleContent
                  ) : (
                    <Link href={`/app/track/issues/${issue.id}`}>
                      {titleContent}
                    </Link>
                  )}
                </td>
                {show("project") && (
                  <td className="hide-sm track-cell-dim track-col-project">
                    {ctx?.name ?? "–"}
                  </td>
                )}
                <td className="track-col-status">
                  {editing ? (
                    // Como en Linear: solo el ícono del estado, que abre el menú.
                    <StatusMenu
                      glyphOnly
                      statusId={issue.status_id}
                      statusName={issue.status_name}
                      statusColor={issue.status_color}
                      statusCategory={issue.status_category}
                      statuses={ctx?.statuses ?? []}
                      disabled={pending}
                      label={editing.ui.inline.status}
                      onChange={(statusId) =>
                        editing.onUpdate(issue.id, { statusId })
                      }
                    />
                  ) : (
                    <StatusBadge
                      name={issue.status_name}
                      color={issue.status_color}
                      category={issue.status_category}
                    />
                  )}
                </td>
                {show("priority") && (
                  <td className="hide-sm track-col-priority">
                    {editing ? (
                      <PriorityMenu
                        compact
                        priority={issue.priority}
                        priorities={editing.ui.priorities}
                        disabled={pending}
                        label={editing.ui.inline.priority}
                        onChange={(priority) =>
                          editing.onUpdate(issue.id, { priority })
                        }
                      />
                    ) : (
                      <span className="track-priority">
                        <PriorityIcon priority={issue.priority} />
                        {issue.priority}
                      </span>
                    )}
                  </td>
                )}
                {show("assignee") && (
                  <td className="hide-sm track-col-assignee">
                    {editing ? (
                      <AssigneeMenu
                        compact
                        assigneeId={issue.assignee_id}
                        assigneeName={issue.assignee_name}
                        assigneeEmail={issue.assignee_email}
                        members={ctx?.members ?? []}
                        disabled={pending}
                        label={editing.ui.inline.assignee}
                        noAssignee={labels.noAssignee}
                        onChange={(assigneeId) =>
                          editing.onUpdate(issue.id, { assigneeId })
                        }
                      />
                    ) : (
                      (issue.assignee_name ??
                      issue.assignee_email ??
                      labels.noAssignee)
                    )}
                  </td>
                )}
                {show("cycle") && (
                  <td className="hide-sm track-col-cycle">
                    {issue.cycle_name ? (
                      <span className="track-row-cycle">
                        <TrackIcon name="cycle" size={11} />
                        {issue.cycle_name}
                      </span>
                    ) : null}
                  </td>
                )}
                {show("due") && (
                  <td className="hide-sm track-col-due">
                    {editing ? (
                      <DueDateMenu
                        dueDate={issue.due_date}
                        locale={locale}
                        today={editing.today}
                        disabled={pending}
                        labels={editing.ui.inline}
                        onChange={(dueDate) =>
                          editing.onUpdate(issue.id, { dueDate })
                        }
                      />
                    ) : issue.due_date ? (
                      formatDate(issue.due_date, locale)
                    ) : (
                      "–"
                    )}
                  </td>
                )}
                {show("created") && (
                  <td className="hide-sm track-cell-dim track-col-created">
                    {formatDate(issue.created_at, locale)}
                  </td>
                )}
              </tr>
            );
          })}
          {quickAdd && editing && (
            <tr className="track-quick-add-tr">
              <td colSpan={columnCount}>
                <QuickAdd
                  labels={editing.ui.quick}
                  onCreate={quickAdd.onCreate}
                  projects={quickAdd.projects}
                  defaultProjectId={quickAdd.defaultProjectId}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
