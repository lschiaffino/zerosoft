'use client';

import { useEffect, useRef } from 'react';
import { CMDK_CLOSED_EVENT, openCommandMenu, setCommandContext, type CommandAction } from '@/lib/cmdk-context';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { branchNameFor } from '@/lib/track-branch';
import { addDays, type IssuePatch, type IssuePriority } from '@/lib/track-tasks';
import { glyphColor, safeHexColor } from '@/lib/track-color';
import { pushNotice } from './trackUndo';

/**
 * Track — acciones sobre issues para la paleta ⌘K y los atajos de una tecla
 * de Linear (S estado, P prioridad, A asignar, I asignarme, L labels,
 * ⇧E estimación, ⇧D vencimiento, ⇧C cycle, ⌘⇧P padre, ⌘⇧O sub-issue,
 * ⌘. copiar ID, ⌘⇧. copiar rama, ⇧1–4 prioridad).
 *
 * El objetivo es la selección (X), si no la fila activa (J/K) o bajo el
 * mouse, y si no el issue abierto. Los atajos abren la misma página de la
 * paleta que ⌘K, así todo se hace con el teclado.
 */

export interface CommandData {
  statuses: Array<{ id: string; name: string; color: string; category: string; position: number; project_id?: string }>;
  members: Array<{ id: string; name: string | null; email: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  cycles: Array<{ id: string; name: string }>;
  milestones: Array<{ id: string; name: string }>;
  priorities: Array<{ value: string; label: string }>;
  meId: string;
  today: string;
}

export interface CommandHandlers {
  apply: (targets: TrackIssueWithStatus[], patch: IssuePatch | ((issue: TrackIssueWithStatus) => IssuePatch)) => void;
  /** "Move to team" (⌘⇧M): mueve los issues a otro team. */
  moveToTeam?: (targets: TrackIssueWithStatus[], teamId: string) => void;
  /** Archivar (⌘K › Archive), como en Linear. */
  archive?: (targets: TrackIssueWithStatus[]) => void;
  createSubIssue?: (parent: TrackIssueWithStatus) => void;
  remove?: (targets: TrackIssueWithStatus[]) => void;
  open?: (issue: TrackIssueWithStatus) => void;
}

type T = (key: string, values?: Record<string, string | number>) => string;

function parseLabelIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((l: { id?: string }) => l.id).filter((x): x is string => Boolean(x)) : [];
  } catch {
    return [];
  }
}

/** Día de la semana (0 = domingo) → próximo viernes / lunes. */
function nextWeekday(today: string, weekday: number, strictlyAfter: boolean): string {
  const d = new Date(`${today}T00:00:00Z`);
  const cur = d.getUTCDay();
  let delta = (weekday - cur + 7) % 7;
  if (delta === 0 && strictlyAfter) delta = 7;
  return addDays(today, delta);
}

/** Lo que se tipea en la página de vencimiento: 2026-11-03, 3/11, 3/11/2026, +5, 5d. */
export function parseDueQuery(raw: string, today: string): string | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  const rel = /^\+?(\d{1,3})\s*d?$/.exec(q);
  if (rel && (q.startsWith('+') || q.endsWith('d'))) return addDays(today, Number(rel[1]));
  const dm = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(q);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    let year = dm[3] ? Number(dm[3]) : Number(today.slice(0, 4));
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const check = new Date(`${iso}T00:00:00Z`);
    if (check.getUTCDate() !== day) return null;
    // Sin año y ya pasó: el del año que viene.
    if (!dm[3] && iso < today) return `${year + 1}${iso.slice(4)}`;
    return iso;
  }
  return null;
}

export const ESTIMATE_OPTIONS = [0, 1, 2, 3, 5, 8, 13];

/** Project (como en Linear, ⇧P): los del workspace, buscados en el servidor. */
export function projectCommand(
  targets: TrackIssueWithStatus[],
  apply: (patch: IssuePatch) => void,
  t: T,
): CommandAction {
  const one = targets.length === 1 ? targets[0] : null;
  return {
    id: 'project',
    label: t('project'),
    meta: '⇧P',
    keywords: 'project proyecto projeto plan roadmap',
    placeholder: t('searchProject'),
    children: () => [],
    load: async (q) => {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      const res = await fetch(`/api/track/plans?${sp.toString()}`).catch(() => null);
      const rows = res?.ok ? ((await res.json()) as { rows: Array<{ id: string; name: string; color?: string; status: string }> }).rows : [];
      return [
        {
          id: 'project:none',
          label: t('noProject'),
          checked: Boolean(one && !one.plan_id),
          run: () => apply({ planId: null }),
        },
        ...rows
          .filter((p) => p.status !== 'canceled' || (one && one.plan_id === p.id))
          .map((p) => ({
            id: `project:${p.id}`,
            label: p.name,
            swatch: p.color ? safeHexColor(p.color, '#5e6ad2') : undefined,
            checked: Boolean(one && one.plan_id === p.id),
            run: () => apply({ planId: p.id }),
          })),
      ];
    },
  };
}

/** Acciones de la paleta para `targets`. Puro salvo los handlers (fácil de testear). */
export function buildIssueActions(
  targets: TrackIssueWithStatus[],
  data: CommandData,
  handlers: CommandHandlers,
  t: T,
  formatDay: (iso: string) => string,
): CommandAction[] {
  if (targets.length === 0) return [];
  const one = targets.length === 1 ? targets[0] : null;
  const sameProject = targets.every((i) => i.project_id === targets[0].project_id);
  const apply = (patch: IssuePatch | ((issue: TrackIssueWithStatus) => IssuePatch)) => handlers.apply(targets, patch);
  const actions: CommandAction[] = [];

  const statuses = data.statuses
    .filter((s) => !s.project_id || s.project_id === targets[0].project_id)
    .sort((a, b) => a.position - b.position);
  if (sameProject && statuses.length) {
    actions.push({
      id: 'status',
      label: t('status'),
      meta: 'S',
      keywords: 'status estado state workflow',
      placeholder: t('status'),
      children: () =>
        statuses.map((s, n) => ({
          id: `status:${s.id}`,
          label: s.name,
          swatch: glyphColor(s.color),
          checked: Boolean(one && one.status_id === s.id),
          meta: n < 9 ? String(n + 1) : undefined,
          run: () => apply({ statusId: s.id }),
        })),
    });
  }

  actions.push({
    id: 'priority',
    label: t('priority'),
    meta: 'P',
    keywords: 'priority prioridad prioridade urgent',
    placeholder: t('priority'),
    children: () =>
      data.priorities.map((p, n) => ({
        id: `priority:${p.value}`,
        label: p.label,
        checked: Boolean(one && one.priority === p.value),
        meta: `⇧${n + 1}`,
        run: () => apply({ priority: p.value as IssuePriority }),
      })),
  });

  actions.push({
    id: 'assignee',
    label: t('assignee'),
    meta: 'A',
    keywords: 'assign assignee asignar atribuir owner',
    placeholder: t('assignee'),
    children: () => [
      {
        id: 'assignee:none',
        label: t('noAssignee'),
        checked: Boolean(one && !one.assignee_id),
        run: () => apply({ assigneeId: null }),
      },
      ...data.members.map((m) => ({
        id: `assignee:${m.id}`,
        label: m.name ?? m.email,
        keywords: m.email,
        checked: Boolean(one && one.assignee_id === m.id),
        meta: m.id === data.meId ? 'I' : undefined,
        run: () => apply({ assigneeId: m.id }),
      })),
    ],
  });
  actions.push({
    id: 'assign-me',
    label: t('assignMe'),
    meta: 'I',
    keywords: 'assign me mí mim self',
    run: () => apply({ assigneeId: data.meId }),
  });

  if (data.labels.length) {
    actions.push({
      id: 'labels',
      label: t('labels'),
      meta: 'L',
      keywords: 'labels etiquetas tags',
      placeholder: t('labels'),
      children: () =>
        data.labels.map((l) => {
          const all = targets.every((i) => parseLabelIds(i.labels).includes(l.id));
          return {
            id: `label:${l.id}`,
            label: l.name,
            swatch: safeHexColor(l.color, '#767676'),
            checked: all,
            keepOpen: true,
            run: () =>
              apply((issue) => {
                const ids = parseLabelIds(issue.labels).filter((x) => x !== l.id);
                return { labels: (all ? ids : [...ids, l.id]).map((id) => ({ id })) };
              }),
          };
        }),
    });
  }

  actions.push({
    id: 'estimate',
    label: t('estimate'),
    meta: '⇧E',
    keywords: 'estimate estimación estimativa points puntos',
    placeholder: t('estimatePlaceholder'),
    children: () => [
      { id: 'estimate:none', label: t('noEstimate'), checked: Boolean(one && one.estimate == null), run: () => apply({ estimate: null }) },
      ...ESTIMATE_OPTIONS.map((n) => ({
        id: `estimate:${n}`,
        label: t('points', { count: n }),
        checked: Boolean(one && one.estimate === n),
        run: () => apply({ estimate: n }),
      })),
    ],
    dynamic: (q) => {
      const n = Number(q.trim());
      if (!q.trim() || !Number.isInteger(n) || n < 0 || n > 999 || ESTIMATE_OPTIONS.includes(n)) return [];
      return [{ id: `estimate:${n}`, label: t('points', { count: n }), run: () => apply({ estimate: n }) }];
    },
  });

  const due = (iso: string | null, label: string, id: string): CommandAction => ({
    id,
    label,
    meta: iso ? formatDay(iso) : undefined,
    checked: Boolean(one && one.due_date === iso),
    run: () => apply({ dueDate: iso }),
  });
  actions.push({
    id: 'due',
    label: t('due'),
    meta: '⇧D',
    keywords: 'due date vencimiento prazo deadline',
    placeholder: t('duePlaceholder'),
    children: () => [
      due(data.today, t('today'), 'due:today'),
      due(addDays(data.today, 1), t('tomorrow'), 'due:tomorrow'),
      due(nextWeekday(data.today, 5, false), t('endOfWeek'), 'due:eow'),
      due(nextWeekday(data.today, 1, true), t('nextWeek'), 'due:nextweek'),
      due(addDays(data.today, 14), t('inTwoWeeks'), 'due:2w'),
      due(null, t('noDue'), 'due:none'),
    ],
    dynamic: (q) => {
      const iso = parseDueQuery(q, data.today);
      return iso ? [due(iso, t('dueOn', { date: formatDay(iso) }), `due:${iso}`)] : [];
    },
  });

  if (sameProject && data.cycles.length) {
    actions.push({
      id: 'cycle',
      label: t('cycle'),
      meta: '⇧C',
      keywords: 'cycle ciclo sprint',
      placeholder: t('cycle'),
      children: () => [
        { id: 'cycle:none', label: t('noCycle'), checked: Boolean(one && !one.cycle_id), run: () => apply({ cycleId: null }) },
        ...data.cycles.map((c) => ({
          id: `cycle:${c.id}`,
          label: c.name,
          checked: Boolean(one && one.cycle_id === c.id),
          run: () => apply({ cycleId: c.id }),
        })),
      ],
    });
  }
  if (sameProject && data.milestones.length) {
    actions.push({
      id: 'milestone',
      label: t('milestone'),
      keywords: 'milestone hito marco',
      placeholder: t('milestone'),
      children: () => [
        {
          id: 'milestone:none',
          label: t('noMilestone'),
          checked: Boolean(one && !one.milestone_id),
          run: () => apply({ milestoneId: null }),
        },
        ...data.milestones.map((m) => ({
          id: `milestone:${m.id}`,
          label: m.name,
          checked: Boolean(one && one.milestone_id === m.id),
          run: () => apply({ milestoneId: m.id }),
        })),
      ],
    });
  }

  actions.push(projectCommand(targets, apply, t));

  if (handlers.moveToTeam) {
    const move = handlers.moveToTeam;
    actions.push({
      id: 'move-team',
      label: t('moveToTeam'),
      meta: '⌘⇧M',
      keywords: 'move team mover equipo equipe transferir',
      placeholder: t('searchTeam'),
      children: () => [],
      load: async (q) => {
        const res = await fetch('/api/track/projects?pageSize=100').catch(() => null);
        const rows = res?.ok ? ((await res.json()) as { rows: Array<{ id: string; name: string; slug: string; status: string; icon: string | null }> }).rows : [];
        const needle = q.trim().toLowerCase();
        return rows
          .filter((r) => r.status === 'active' && !targets.every((i) => i.project_id === r.id))
          .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle))
          .map((r) => ({
            id: `move-team:${r.id}`,
            label: r.name,
            meta: r.slug.toUpperCase(),
            run: () => move(targets, r.id),
          }));
      },
    });
  }

  // Jerarquía: elegir padre (búsqueda en el servidor), sacarlo, crear sub-issue.
  const targetIds = new Set(targets.map((i) => i.id));
  actions.push({
    id: 'parent',
    label: t('setParent'),
    meta: '⌘⇧P',
    keywords: 'parent padre pai sub-issue subissue convert',
    placeholder: t('searchParent'),
    children: () => [],
    load: async (q) => {
      const sp = new URLSearchParams({ pageSize: '12' });
      if (q.trim()) sp.set('q', q.trim());
      const res = await fetch(`/api/track/issues?${sp.toString()}`);
      if (!res.ok) return [];
      const rows = ((await res.json()) as { rows: TrackIssueWithStatus[] }).rows;
      return rows
        .filter((r) => !targetIds.has(r.id))
        .map((r) => ({
          id: `parent:${r.id}`,
          label: `${r.identifier} ${r.title}`,
          swatch: r.status_color ? safeHexColor(r.status_color, '#767676') : undefined,
          checked: Boolean(one && one.parent_id === r.id),
          run: () => apply({ parentId: r.id }),
        }));
    },
  });
  if (targets.some((i) => i.parent_id)) {
    actions.push({
      id: 'remove-parent',
      label: t('removeParent'),
      keywords: 'parent padre quitar remove',
      run: () => apply({ parentId: null }),
    });
  }
  if (one && handlers.createSubIssue) {
    const create = handlers.createSubIssue;
    actions.push({
      id: 'sub-issue',
      label: t('createSubIssue'),
      meta: '⌘⇧O',
      keywords: 'sub-issue subissue child hijo filho create crear',
      run: () => create(one),
    });
  }

  if (one) {
    const copy = (text: string, what: string) => {
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      pushNotice(t('copied', { what }));
    };
    actions.push(
      {
        id: 'copy-id',
        label: t('copyId'),
        meta: '⌘.',
        keywords: 'copy copiar id identifier',
        run: () => copy(one.identifier, one.identifier),
      },
      {
        id: 'copy-link',
        label: t('copyLink'),
        meta: '⌘⇧,',
        keywords: 'copy copiar link url',
        run: () => copy(new URL(`/app/track/issues/${one.id}`, window.location.origin).toString(), t('link')),
      },
      {
        id: 'copy-branch',
        label: t('copyBranch'),
        meta: '⌘⇧.',
        keywords: 'copy copiar git branch rama',
        run: () => {
          const branch = branchNameFor(one.identifier, one.title);
          copy(branch, branch);
        },
      },
    );
    if (handlers.open) {
      const open = handlers.open;
      actions.push({ id: 'open', label: t('open'), meta: '↵', keywords: 'open abrir', run: () => open(one) });
    }
  }
  if (handlers.archive && targets.every((i) => !i.archived_at)) {
    const archive = handlers.archive;
    actions.push({
      id: 'archive',
      label: targets.length > 1 ? t('archiveMany', { count: targets.length }) : t('archive'),
      keywords: 'archive archivar arquivar',
      run: () => archive(targets),
    });
  }
  if (handlers.remove) {
    const remove = handlers.remove;
    actions.push({
      id: 'delete',
      label: targets.length > 1 ? t('deleteMany', { count: targets.length }) : t('delete'),
      meta: '⌘⌫',
      keywords: 'delete borrar excluir remove',
      run: () => remove(targets),
    });
  }
  return actions;
}

// ---------- Objetivo y atajos ----------

// "G" seguido de una tecla es navegación (TrackShortcuts): la segunda tecla no es un atajo de propiedad.
let goPendingAt = 0;
export function markGoPending(at = Date.now()) {
  goPendingAt = at;
}
function inGoSequence(): boolean {
  return Date.now() - goPendingAt < 1200;
}

/** Fila de issue activa (J/K) o bajo el mouse, si hay. */
export function rowTargetId(): string | null {
  const row =
    document.querySelector<HTMLElement>('[data-issue-key].is-kb-active') ??
    document.querySelector<HTMLElement>('[data-issue-key]:hover');
  return row?.dataset.issueKey ?? null;
}

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.isContentEditable || Boolean(node.closest('input, textarea, select, [contenteditable="true"]'));
}

function overlayOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"], dialog[open], .cmdk, [role="menu"]'));
}

/** Atajo → página de la paleta o acción directa. Exportado para tests. */
export function shortcutFor(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>):
  | { page: string }
  | { run: string }
  | null {
  if (e.altKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod) {
    if (e.shiftKey && (key === 'p' || e.code === 'KeyP')) return { page: 'parent' };
    if (e.shiftKey && (key === 'm' || e.code === 'KeyM')) return { page: 'move-team' };
    if (e.shiftKey && (key === 'o' || e.code === 'KeyO')) return { run: 'sub-issue' };
    if (e.shiftKey && (key === '.' || key === '>' || e.code === 'Period')) return { run: 'copy-branch' };
    if (!e.shiftKey && (key === '.' || e.code === 'Period')) return { run: 'copy-id' };
    return null;
  }
  if (e.shiftKey) {
    if (e.code === 'KeyE' || key === 'e') return { page: 'estimate' };
    if (e.code === 'KeyD' || key === 'd') return { page: 'due' };
    if (e.code === 'KeyC' || key === 'c') return { page: 'cycle' };
    if (e.code === 'KeyP' || key === 'p') return { page: 'project' };
    const digit = /^Digit([1-4])$/.exec(e.code ?? '');
    if (digit) return { run: `priority:${digit[1]}` };
    return null;
  }
  switch (key) {
    case 's':
      return { page: 'status' };
    case 'p':
      return { page: 'priority' };
    case 'a':
      return { page: 'assignee' };
    case 'l':
      return { page: 'labels' };
    case 'i':
      return { run: 'assign-me' };
    default:
      return null;
  }
}

interface UseTrackCommandsOptions {
  /** Issues sobre los que actúan (ya resuelta la prioridad selección > fila > issue abierto). */
  getTargets: () => TrackIssueWithStatus[];
  data: CommandData;
  handlers: CommandHandlers;
  t: T;
  formatDay: (iso: string) => string;
  /** Versión actual de un issue por id (las acciones de la paleta abierta no quedan viejas). */
  lookup?: (id: string) => TrackIssueWithStatus | undefined;
  /** Acciones propias de la vista (p. ej. "Agregar sub-issue existente"). */
  extra?: (targets: TrackIssueWithStatus[]) => CommandAction[];
  enabled?: boolean;
}

/** Registra las acciones en ⌘K y los atajos de una tecla mientras la vista está montada. */
export function useTrackCommands(opts: UseTrackCommandsOptions): void {
  const ref = useRef(opts);
  ref.current = opts;
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const title = (targets: TrackIssueWithStatus[]) =>
      targets.length === 1 ? targets[0].identifier : ref.current.t('many', { count: targets.length });
    // Al abrir la paleta el fondo tapa la fila bajo el mouse: los objetivos se
    // fijan en ese momento y se vuelven a leer frescos (por id) en cada render.
    let pinned: Map<string, TrackIssueWithStatus> | null = null;
    const pin = (targets: TrackIssueWithStatus[]) => {
      pinned = new Map(targets.map((i) => [i.id, i]));
    };
    const current = (): TrackIssueWithStatus[] => {
      const o = ref.current;
      if (!pinned) return o.getTargets();
      return Array.from(pinned.values()).map((i) => o.lookup?.(i.id) ?? i);
    };
    const onCmdK = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !document.querySelector('.cmdk')) pin(ref.current.getTargets());
    };
    const onClosed = () => {
      pinned = null;
    };
    window.addEventListener('keydown', onCmdK, true);
    window.addEventListener(CMDK_CLOSED_EVENT, onClosed);
    const build = () => {
      const o = ref.current;
      const targets = current();
      if (targets.length === 0) return null;
      const actions = buildIssueActions(targets, o.data, o.handlers, o.t, o.formatDay);
      return { title: title(targets), actions: [...actions, ...(o.extra?.(targets) ?? [])] };
    };
    const off = setCommandContext(build);

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || isTypingTarget(e.target) || overlayOpen()) return;
      if (!(e.metaKey || e.ctrlKey) && inGoSequence()) return;
      const sc = shortcutFor(e);
      if (!sc) return;
      const o = ref.current;
      const targets = o.getTargets();
      if (targets.length === 0) return;
      const actions = buildIssueActions(targets, o.data, o.handlers, o.t, o.formatDay);
      if ('page' in sc) {
        if (!actions.some((a) => a.id === sc.page)) return;
        e.preventDefault();
        pin(targets);
        openCommandMenu(sc.page);
        return;
      }
      if (sc.run.startsWith('priority:')) {
        const p = o.data.priorities[Number(sc.run.slice(9)) - 1];
        if (!p) return;
        e.preventDefault();
        o.handlers.apply(targets, { priority: p.value as IssuePriority });
        return;
      }
      const action = actions.find((a) => a.id === sc.run);
      if (!action?.run) return;
      e.preventDefault();
      action.run();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onCmdK, true);
      window.removeEventListener(CMDK_CLOSED_EVENT, onClosed);
    };
  }, [enabled]);
}
