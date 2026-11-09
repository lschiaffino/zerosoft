"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { TrackStatusRow } from "@/lib/db";
import type { TrackIssueWithStatus } from "@/lib/track-data";
import {
  groupIssues,
  groupPreset,
  groupDropTarget,
  type GroupContext,
  type GroupPreset,
  type IssueGroup,
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
  groupLabels: { noCycle: string; noLabel: string; noMilestone?: string; noProject?: string };
  /** Milestones del project en orden (agrupar por milestone). */
  milestones?: Array<{ id: string; name: string }>;
  /** "Show empty groups": status, prioridad y milestones sin issues también se ven. */
  showEmpty?: boolean;
  priorities: Array<{ value: string; label: string }>;
  editing: IssuesTableEditing;
  /** "+ New issue" al pie de cada grupo que se puede asignar, con su valor preseteado. */
  onQuickCreate?: (title: string, preset: GroupPreset, projectId: string) => void;
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
  /** Sub-agrupado dentro de cada grupo (Display › Sub-grouping), como Linear. */
  subGroupBy?: IssueGroupBy;
  /** Total real de cada grupo en el servidor (clave del grupo); sin esto se cuentan los cargados. */
  counts?: Record<string, number>;
  /** Total real de cada sub-grupo, con clave `grupo\u0001subgrupo`. */
  subCounts?: Record<string, number>;
  /** Trae la página siguiente: aparece al pie de un grupo con más issues en el servidor que los cargados. */
  loadMore?: { onLoad: () => void; label: string; busy?: boolean };
}

const SEP = "\u0001";

type Group = IssueGroup<TrackIssueWithStatus> & { subs: IssueGroup<TrackIssueWithStatus>[] | null };

/**
 * Lista agrupada: una sección por valor (status, persona, prioridad, cycle,
 * label o proyecto), cada una con su tabla y, con sub-agrupado, una
 * sub-sección por valor del segundo campo. Dentro de cada grupo se respeta el
 * orden que vino del servidor. Grupos y sub-grupos llevan data-track-drop
 * (soltar issues ahí cambia esa propiedad).
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
  milestones,
  showEmpty = false,
  subGroupBy = "none",
  counts,
  subCounts,
  loadMore,
}: GroupedIssuesTableProps) {
  const td = useTranslations("track.ux.display");
  // Grupos contraídos (clic o Enter en el encabezado), como en Linear.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const idWidth = useMemo(() => identifierWidth(issues), [issues]);
  const sub = subGroupBy !== "none" && subGroupBy !== groupBy ? subGroupBy : null;
  const groups = useMemo<Group[]>(() => {
    const ctx: GroupContext = { statuses, projectNames, statusByName, activeFirst: true, milestones, includeEmpty: showEmpty };
    // Como Linear: cada issue en su propio grupo (un sub-issue en el de su
    // status, no en el del padre); dentro del grupo va debajo de su padre si
    // el padre también está ahí (IssuesTable con `nested`).
    return groupIssues(issues, groupBy, ctx).map((g) => ({
      ...g,
      subs: sub ? groupIssues(g.issues, sub, { ...ctx, includeEmpty: false }) : null,
    }));
  }, [issues, groupBy, sub, statuses, projectNames, statusByName, milestones, showEmpty]);

  if (groups.length === 0) return <EmptyState quiet title={labels.empty} />;

  const titleFor = (field: IssueGroupBy, key: string, name: string) => {
    if (field === "priority") return priorities.find((p) => p.value === key)?.label ?? key;
    if (key) return name || editing.projects[key]?.name || key;
    if (field === "assignee") return labels.noAssignee;
    if (field === "cycle") return groupLabels.noCycle;
    if (field === "label") return groupLabels.noLabel;
    if (field === "planMilestone") return groupLabels.noMilestone ?? name;
    if (field === "plan") return groupLabels.noProject ?? name;
    return name;
  };
  const title = (key: string, name: string) => titleFor(groupBy, key, name);

  // La columna del campo agrupado se repetiría en cada fila: se oculta.
  const fields: IssueGroupBy[] = sub ? [groupBy, sub] : [groupBy];
  const hidden: OptionalColumn[] = [
    ...hideColumns,
    ...(fields.includes("assignee") ? (["assignee"] as const) : []),
    ...(fields.includes("cycle") ? (["cycle"] as const) : []),
    ...(fields.includes("project") ? (["project"] as const) : []),
  ];
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Ícono del valor (estado, prioridad, color del label, milestone, project). */
  const glyph = (field: IssueGroupBy, g: IssueGroup<TrackIssueWithStatus>) => (
    <>
      {field === "status" && <StatusDot color={g.color ?? null} category={g.category ?? null} />}
      {field === "priority" && <PriorityIcon priority={g.key as TrackIssueWithStatus["priority"]} />}
      {field === "label" && g.color && <span className="track-label-tag-dot" style={{ background: g.color }} aria-hidden />}
      {field === "planMilestone" && <span className="tp-ms-diamond" aria-hidden />}
      {field === "plan" && <TrackIcon name="plans" size={13} />}
    </>
  );

  const quickOk = (preset: GroupPreset | null, projectId: string | undefined) =>
    Boolean(onQuickCreate) && Boolean(preset || projectId) && (!quickAddGroups || quickAddGroups.includes(groupBy));

  const table = (rows: TrackIssueWithStatus[], preset: GroupPreset | null, projectId: string | undefined) => (
    <IssuesTable
      idWidth={idWidth}
      issues={rows}
      locale={locale}
      labels={labels}
      editing={editing}
      hideColumns={hidden}
      showHeader={false}
      fixedLayout
      selection={selection}
      nested={nested}
      quickAdd={
        onQuickCreate && quickOk(preset, projectId)
          ? {
              onCreate: (text, pid) => onQuickCreate(text, preset ?? {}, pid),
              projects: projectId ? undefined : quickAddProjects,
              defaultProjectId: projectId,
            }
          : undefined
      }
    />
  );

  // Más issues en el servidor que los cargados en este grupo: "Load more" al pie.
  const more = (total: number | undefined, loaded: number) =>
    loadMore && total !== undefined && total > loaded ? (
      <div className="track-group-more-row">
        <button
          type="button"
          className="btn btn-ghost btn-sm track-group-more"
          onClick={loadMore.onLoad}
          aria-busy={loadMore.busy || undefined}
          disabled={loadMore.busy}
          data-testid="track-group-more"
        >
          {loadMore.label}
          <span className="track-mytasks-count">{total - loaded}</span>
        </button>
      </div>
    ) : null;

  return (
    <div className="track-mytasks track-groups">
      {groups.map((g) => {
        const id = `track-group-${groupBy}-${g.key || "none"}`;
        const preset = groupPreset(groupBy, g.key);
        const projectId = groupBy === "project" ? g.key : undefined;
        const total = counts?.[g.key];
        const isCollapsed = collapsed.has(g.key);
        return (
          <section
            key={g.key || "none"}
            className={`track-mytasks-group${isCollapsed ? " is-collapsed" : ""}`}
            aria-labelledby={id}
            data-testid="track-group"
            // Soltar issues arrastrados en el grupo cambia esa propiedad (TrackIssueDnd), como Linear.
            data-track-drop={groupDropTarget(groupBy, g.key, !!statusByName)}
          >
            <h2 className="track-mytasks-title track-group-title">
              <button
                type="button"
                id={id}
                className="track-group-toggle"
                aria-expanded={!isCollapsed}
                aria-label={td(isCollapsed ? "expand" : "collapse", { name: title(g.key, g.name) })}
                onClick={() => toggle(g.key)}
                data-testid="track-group-toggle"
              >
                <span className="track-group-chevron" aria-hidden>
                  <TrackIcon name="chevronDown" size={10} />
                </span>
                {glyph(groupBy, g)}
                <span className="track-group-name">{title(g.key, g.name)}</span>
                <span className="track-mytasks-count" data-testid="track-group-count">
                  {total ?? g.issues.length}
                </span>
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
            {!isCollapsed && !g.subs && table(g.issues, preset, projectId)}
            {!isCollapsed && !g.subs && more(total, g.issues.length)}
            {!isCollapsed &&
              sub &&
              g.subs?.map((s) => {
                const subKey = `${g.key}${SEP}${s.key}`;
                const subPreset = groupPreset(sub, s.key);
                const merged = preset || subPreset ? { ...(preset ?? {}), ...(subPreset ?? {}) } : null;
                const subProject = projectId ?? (sub === "project" ? s.key : undefined);
                const subCollapsed = collapsed.has(subKey);
                const subTotal = subCounts?.[subKey];
                const subTitle = titleFor(sub, s.key, s.name);
                return (
                  <section
                    key={s.key || "none"}
                    className={`track-subgroup${subCollapsed ? " is-collapsed" : ""}`}
                    aria-label={`${title(g.key, g.name)}: ${subTitle}`}
                    data-testid="track-subgroup"
                    data-track-drop={groupDropTarget(sub, s.key, !!statusByName)}
                  >
                    <h3 className="track-subgroup-title">
                      <button
                        type="button"
                        className="track-group-toggle track-subgroup-toggle"
                        aria-expanded={!subCollapsed}
                        aria-label={td(subCollapsed ? "expand" : "collapse", { name: subTitle })}
                        onClick={() => toggle(subKey)}
                        data-testid="track-subgroup-toggle"
                      >
                        <span className="track-group-chevron" aria-hidden>
                          <TrackIcon name="chevronDown" size={10} />
                        </span>
                        {glyph(sub, s)}
                        <span className="track-group-name">{subTitle}</span>
                        <span className="track-mytasks-count">{subTotal ?? s.issues.length}</span>
                      </button>
                    </h3>
                    {!subCollapsed && table(s.issues, merged, subProject)}
                    {!subCollapsed && more(subTotal, s.issues.length)}
                  </section>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}
