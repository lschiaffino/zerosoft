"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { TrackStatusRow } from "@/lib/db";
import type { TrackIssueWithStatus } from "@/lib/track-data";
import { treeRoots,
  groupIssues,
  groupPreset,
  type GroupPreset,
  type IssueGroupBy,
} from "@/lib/track-views";
import IssuesTable, {
  identifierWidth,
  type IssuesTableEditing,
  type OptionalColumn,
} from "./IssuesTable";
import TrackIcon from "./TrackIcon";
import { PriorityIcon, StatusDot } from "./InlineEditors";
import EmptyState from "@/components/ui/EmptyState";
import type { IssueSelection } from "./BulkEdit";

interface GroupedIssuesTableProps {
  issues: TrackIssueWithStatus[];
  groupBy: Exclude<IssueGroupBy, "none">;
  statuses?: TrackStatusRow[];
  /** Nombres de proyecto por id (agrupar por proyecto). */
  projectNames?: Record<string, string>;
  /** Varios proyectos: los status se juntan por nombre. */
  statusByName?: boolean;
  locale: string;
  labels: Parameters<typeof IssuesTable>[0]["labels"];
  groupLabels: { noCycle: string; noLabel: string };
  priorities: Array<{ value: string; label: string }>;
  editing: IssuesTableEditing;
  /** "+ New issue" al pie de cada grupo que se puede asignar, con su valor preseteado. */
  onQuickCreate?: (
    title: string,
    preset: GroupPreset,
    projectId: string,
  ) => void;
  /** Proyectos para el quick-add (vista de varios proyectos). */
  quickAddProjects?: Array<{ id: string; name: string }>;
  /**
   * Agrupados con quick-add. Con varios proyectos, persona y cycle dependen
   * del proyecto elegido, así que ahí solo se ofrece en prioridad y proyecto.
   */
  quickAddGroups?: readonly IssueGroupBy[];
  hideColumns?: OptionalColumn[];
  selection?: IssueSelection & { label: string; allLabel: string };
  /** Sub-issues debajo de su padre dentro de cada grupo. */
  nested?: boolean;
  /** "+" en el encabezado del grupo: crear un issue con ese valor (abre el composer). */
  onAddInGroup?: (preset: GroupPreset, groupName: string) => void;
}

/**
 * Lista agrupada: una sección por valor (status, persona, prioridad, cycle,
 * label o proyecto), cada una con su tabla. Dentro de cada grupo se respeta
 * el orden que vino del servidor.
 */
export default function GroupedIssuesTable({
  issues,
  groupBy,
  statuses,
  projectNames,
  statusByName,
  locale,
  labels,
  groupLabels,
  priorities,
  editing,
  onQuickCreate,
  quickAddProjects,
  quickAddGroups,
  hideColumns = [],
  selection,
  nested = false,
  onAddInGroup,
}: GroupedIssuesTableProps) {
  const td = useTranslations("track.ux.display");
  // Grupos contraídos (clic o Enter en el encabezado), como en Linear.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const idWidth = useMemo(() => identifierWidth(issues), [issues]);
  const groups = useMemo(() => {
    if (!nested) return groupIssues(issues, groupBy, { statuses, projectNames, statusByName, activeFirst: true });
    // Árbol: se agrupan las raíces y cada sub-issue va bajo su padre, en el grupo del padre.
    const { roots, expand } = treeRoots(issues);
    return groupIssues(roots, groupBy, { statuses, projectNames, statusByName, activeFirst: true }).map((g) => ({
      ...g,
      issues: expand(g.issues),
    }));
  }, [issues, groupBy, statuses, projectNames, statusByName, nested]);

  if (groups.length === 0) return <EmptyState quiet title={labels.empty} />;

  const title = (key: string, name: string) => {
    if (groupBy === "priority")
      return priorities.find((p) => p.value === key)?.label ?? key;
    if (key) return name || editing.projects[key]?.name || key;
    if (groupBy === "assignee") return labels.noAssignee;
    if (groupBy === "cycle") return groupLabels.noCycle;
    if (groupBy === "label") return groupLabels.noLabel;
    return name;
  };

  // La columna del campo agrupado se repetiría en cada fila: se oculta.
  const hidden: OptionalColumn[] = [
    ...hideColumns,
    ...(groupBy === "assignee" ? (["assignee"] as const) : []),
    ...(groupBy === "cycle" ? (["cycle"] as const) : []),
    ...(groupBy === "project" ? (["project"] as const) : []),
  ];

  return (
    <div className="track-mytasks track-groups">
      {groups.map((g) => {
        const id = `track-group-${groupBy}-${g.key || "none"}`;
        const preset = groupPreset(groupBy, g.key);
        const projectId = groupBy === "project" ? g.key : undefined;
        const canQuickAdd =
          onQuickCreate &&
          (preset || projectId) &&
          (!quickAddGroups || quickAddGroups.includes(groupBy));
        return (
          <section
            key={g.key || "none"}
            className={`track-mytasks-group${collapsed.has(g.key) ? " is-collapsed" : ""}`}
            aria-labelledby={id}
            data-testid="track-group"
          >
            <h2 className="track-mytasks-title track-group-title">
              <button
                type="button"
                id={id}
                className="track-group-toggle"
                aria-expanded={!collapsed.has(g.key)}
                aria-label={td(collapsed.has(g.key) ? "expand" : "collapse", {
                  name: title(g.key, g.name),
                })}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.key)) next.delete(g.key);
                    else next.add(g.key);
                    return next;
                  })
                }
                data-testid="track-group-toggle"
              >
                <span className="track-group-chevron" aria-hidden>
                  <TrackIcon name="chevronDown" size={10} />
                </span>
                {groupBy === "status" && (
                  <StatusDot
                    color={g.color ?? null}
                    category={g.category ?? null}
                  />
                )}
                {groupBy === "priority" && (
                  <PriorityIcon
                    priority={g.key as TrackIssueWithStatus["priority"]}
                  />
                )}
                {groupBy === "label" && g.color && (
                  <span
                    className="track-label-tag-dot"
                    style={{ background: g.color }}
                    aria-hidden
                  />
                )}
                <span className="track-group-name">{title(g.key, g.name)}</span>
                <span className="track-mytasks-count">{g.issues.length}</span>
              </button>
              {onAddInGroup && preset && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon track-group-add"
                  aria-label={td("addInGroup", { name: title(g.key, g.name) })}
                  title={td("addInGroup", { name: title(g.key, g.name) })}
                  onClick={() => onAddInGroup(preset, title(g.key, g.name))}
                  data-testid="track-group-add"
                >
                  <TrackIcon name="plus" size={13} />
                </button>
              )}
            </h2>
            {!collapsed.has(g.key) && (
              <IssuesTable
                idWidth={idWidth}
                issues={g.issues}
                locale={locale}
                labels={labels}
                editing={editing}
                hideColumns={hidden}
                showHeader={false}
                fixedLayout
                selection={selection}
                nested={nested}
                quickAdd={
                  canQuickAdd
                    ? {
                        onCreate: (text, pid) =>
                          onQuickCreate(text, preset ?? {}, pid),
                        projects: projectId ? undefined : quickAddProjects,
                        defaultProjectId: projectId,
                      }
                    : undefined
                }
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
