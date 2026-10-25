'use client';

import { useEffect, useRef } from 'react';
import { CMDK_CLOSED_EVENT, OPEN_SEARCH_EVENT, openCommandMenu, setCommandContext, type CommandAction, type OpenCommandDetail } from '@/lib/cmdk-context';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { branchNameFor } from '@/lib/track-branch';
import { estimateOptions } from '@/lib/track-estimates';
import { addDays, type IssuePatch, type IssuePriority } from '@/lib/track-tasks';
import { glyphColor, safeHexColor } from '@/lib/track-color';
import { pushNotice } from './trackUndo';
import { activeRowElement } from './kbCursor';

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
  cycles: Array<{ id: string; name: string; start_at?: string; end_at?: string }>;
  milestones: Array<{ id: string; name: string }>;
  priorities: Array<{ value: string; label: string }>;
  meId: string;
  today: string;
  /** Escala de estimación del team (fibonacci por defecto). */
  estimateScale?: string;
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
  /** "Mark as duplicate": relación duplicates con el canónico y estado cancelado. */
  markDuplicate?: (issue: TrackIssueWithStatus, canonical: TrackIssueWithStatus) => void;
  /** Suscripción a los avisos del issue abierto. */
  subscription?: { subscribed: () => boolean; toggle: () => void };
}

type T = (key: string, values?: Record<string, string | number>) => string;

function parseLabelList(raw: string): Array<{ id: string; name: string; color: string }> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter((l: { id?: unknown }) => typeof l?.id === 'string')
          .map((l: { id: string; name?: string; color?: string }) => ({ id: l.id, name: l.name ?? '', color: l.color ?? '#767676' }))
      : [];
  } catch {
    return [];
  }
}

function parseLabelIds(raw: string): string[] {
  return parseLabelList(raw).map((l) => l.id);
}

/** URL del issue (por identificador, como Linear: /app/track/issue/WEB-12). */
export function issueHref(issue: Pick<TrackIssueWithStatus, 'id' | 'identifier'> & { title?: string }): string {
  const slug = (issue.title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `/app/track/issue/${encodeURIComponent(issue.identifier)}${slug ? `/${slug}` : ''}`;
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

/** Opciones de estimación según la escala del team (lib/track-estimates; talles con su etiqueta). */
export function estimateChoices(scale?: string): Array<{ value: number; label?: string }> {
  return estimateOptions(scale).map((o) => (scale === 'tshirt' ? o : { value: o.value }));
}

/** Orden del menú de prioridad (como Linear): Sin prioridad 0, Urgente 1 … Baja 4. */
export const PRIORITY_MENU_ORDER: IssuePriority[] = ['none', 'urgent', 'high', 'medium', 'low'];

// Labels frescos: el menú L los vuelve a pedir al abrirse (los creados en el
// sidebar o en otra pestaña aparecen sin recargar) y suma los creados en línea.
let labelCache: CommandData['labels'] | null = null;
export function rememberLabels(rows: CommandData['labels'] | null): void {
  labelCache = rows;
}
function currentLabels(data: CommandData): CommandData['labels'] {
  if (!labelCache) return data.labels;
  const byId = new Map(data.labels.map((l) => [l.id, l]));
  for (const l of labelCache) byId.set(l.id, l);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchLabels(): Promise<void> {
  const res = await fetch('/api/track/labels').catch(() => null);
  if (!res?.ok) return;
  const rows = ((await res.json()) as { rows: CommandData['labels'] }).rows;
  labelCache = rows.map((r) => ({ id: r.id, name: r.name, color: r.color }));
}

/** Crea un label del workspace (o lo encuentra si ya existe con ese nombre). */
export async function createLabelNamed(name: string): Promise<CommandData['labels'][number] | null> {
  const res = await fetch('/api/track/labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).catch(() => null);
  if (res?.ok) {
    const label = (await res.json()) as CommandData['labels'][number];
    labelCache = [...(labelCache ?? []).filter((l) => l.id !== label.id), { id: label.id, name: label.name, color: label.color }];
    return label;
  }
  if (res?.status === 409) {
    await fetchLabels();
    return (labelCache ?? []).find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? null;
  }
  return null;
}

/** Project (como en Linear, ⇧P): los del workspace, buscados en el servidor, y crear uno nuevo tipeando. */
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
    icon: { kind: 'glyph', name: 'project' },
    children: () => [
      {
        id: 'project:none',
        label: t('noProject'),
        isNone: true,
        icon: { kind: 'glyph', name: 'project' },
        checked: Boolean(one && !one.plan_id),
        run: () => apply({ planId: null }),
      },
    ],
    load: async (q) => {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      const res = await fetch(`/api/track/plans?${sp.toString()}`).catch(() => null);
      const rows = res?.ok ? ((await res.json()) as { rows: Array<{ id: string; name: string; color?: string; status: string }> }).rows : [];
      return rows
        .filter((p) => p.status !== 'canceled' || (one && one.plan_id === p.id))
        .map((p) => ({
          id: `project:${p.id}`,
          label: p.name,
          icon: { kind: 'swatch' as const, color: p.color ? safeHexColor(p.color, '#5e6ad2') : '#5e6ad2' },
          checked: Boolean(one && one.plan_id === p.id),
          run: () => apply({ planId: p.id }),
        }));
    },
    create: {
      label: (q) => t('createProject', { name: q }),
      run: async (q) => {
        const res = await fetch('/api/track/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: q, teamIds: [...new Set(targets.map((i) => i.project_id))] }),
        }).catch(() => null);
        if (!res?.ok) {
          pushNotice(t('createFailed'));
          return;
        }
        const plan = (await res.json()) as { id: string };
        apply({ planId: plan.id });
      },
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
  const flat: CommandAction[] = [];

  const statuses = data.statuses
    .filter((s) => !s.project_id || s.project_id === targets[0].project_id)
    .sort((a, b) => a.position - b.position);
  if (sameProject && statuses.length) {
    const cur = one ? statuses.find((s) => s.id === one.status_id) : undefined;
    actions.push({
      id: 'status',
      label: t('status'),
      meta: 'S',
      keywords: 'status estado state workflow',
      placeholder: t('status'),
      icon: { kind: 'status', color: cur?.color ?? null, category: cur?.category ?? 'todo' },
      children: () =>
        statuses.map((s, n) => ({
          id: `status:${s.id}`,
          label: s.name,
          icon: { kind: 'status' as const, color: s.color, category: s.category },
          checked: Boolean(one && one.status_id === s.id),
          meta: n < 9 ? String(n + 1) : undefined,
          digit: n < 9 ? String(n + 1) : undefined,
          run: () => apply({ statusId: s.id }),
        })),
    });
    for (const s of statuses) {
      flat.push({
        id: `flat-status:${s.id}`,
        label: t('changeStatusTo', { name: s.name }),
        keywords: `status estado ${s.name}`,
        icon: { kind: 'status', color: s.color, category: s.category },
        searchOnly: true,
        checked: Boolean(one && one.status_id === s.id),
        run: () => apply({ statusId: s.id }),
      });
    }
  }

  const priorityLabel = (v: string) => data.priorities.find((p) => p.value === v)?.label ?? v;
  const prioOptions = PRIORITY_MENU_ORDER.filter((v) => v === 'none' || data.priorities.some((p) => p.value === v));
  actions.push({
    id: 'priority',
    label: t('priority'),
    meta: 'P',
    keywords: 'priority prioridad prioridade urgent',
    placeholder: t('priority'),
    icon: { kind: 'priority', value: one?.priority ?? 'medium' },
    children: () =>
      prioOptions.map((v, n) => ({
        id: `priority:${v}`,
        label: v === 'none' ? t('noPriority') : priorityLabel(v),
        icon: { kind: 'priority' as const, value: v },
        checked: Boolean(one && one.priority === v),
        meta: String(n),
        digit: String(n),
        run: () => apply({ priority: v }),
      })),
  });
  for (const v of prioOptions) {
    flat.push({
      id: `flat-priority:${v}`,
      label: t('setPriorityTo', { name: v === 'none' ? t('noPriority') : priorityLabel(v) }),
      keywords: `priority prioridad ${v}`,
      icon: { kind: 'priority', value: v },
      searchOnly: true,
      run: () => apply({ priority: v }),
    });
  }

  actions.push({
    id: 'assignee',
    label: t('assignee'),
    meta: 'A',
    keywords: 'assign assignee asignar atribuir owner',
    placeholder: t('assignee'),
    icon: { kind: 'glyph', name: 'user' },
    children: () => [
      {
        id: 'assignee:none',
        label: t('noAssignee'),
        isNone: true,
        icon: { kind: 'avatar', name: null, empty: true },
        checked: Boolean(one && !one.assignee_id),
        meta: '0',
        digit: '0',
        run: () => apply({ assigneeId: null }),
      },
      ...data.members.map((m) => ({
        id: `assignee:${m.id}`,
        label: m.name ?? m.email,
        keywords: m.email,
        icon: { kind: 'avatar' as const, name: m.name ?? m.email },
        checked: Boolean(one && one.assignee_id === m.id),
        meta: m.id === data.meId ? 'I' : undefined,
        run: () => apply({ assigneeId: m.id }),
      })),
    ],
  });
  for (const m of data.members) {
    flat.push({
      id: `flat-assignee:${m.id}`,
      label: t('assignTo', { name: m.name ?? m.email }),
      keywords: `assign asignar ${m.email}`,
      icon: { kind: 'avatar', name: m.name ?? m.email },
      searchOnly: true,
      run: () => apply({ assigneeId: m.id }),
    });
  }
  actions.push({
    id: 'assign-me',
    label: t('assignMe'),
    meta: 'I',
    keywords: 'assign me mí mim self',
    icon: { kind: 'glyph', name: 'user' },
    run: () => apply({ assigneeId: data.meId }),
  });

  // Labels: siempre (aunque el team no tenga ninguno todavía), frescos al
  // abrir y con "Crear label" al tipear uno que no existe.
  const labelOption = (l: CommandData['labels'][number]): CommandAction => {
    const all = targets.every((i) => parseLabelIds(i.labels).includes(l.id));
    return {
      id: `label:${l.id}`,
      label: l.name,
      icon: { kind: 'swatch', color: safeHexColor(l.color, '#767676') },
      checked: all,
      keepOpen: true,
      run: () =>
        apply((issue) => {
          const cur = parseLabelList(issue.labels).filter((x) => x.id !== l.id);
          return { labels: all ? cur : [...cur, { id: l.id, name: l.name, color: l.color }] };
        }),
    };
  };
  actions.push({
    id: 'labels',
    label: t('labels'),
    meta: 'L',
    keywords: 'labels etiquetas tags add agregar',
    placeholder: t('labelsPlaceholder'),
    icon: { kind: 'glyph', name: 'tag' },
    children: () => currentLabels(data).map(labelOption),
    load: async () => {
      await fetchLabels();
      return [];
    },
    create: {
      keepOpen: true,
      label: (q) => t('createLabel', { name: q }),
      run: async (q) => {
        const label = await createLabelNamed(q);
        if (!label) {
          pushNotice(t('createFailed'));
          return;
        }
        apply((issue) => {
          const cur = parseLabelList(issue.labels).filter((x) => x.id !== label.id);
          return { labels: [...cur, { id: label.id, name: label.name, color: label.color }] };
        });
      },
    },
  });
  if (targets.some((i) => parseLabelIds(i.labels).length > 0)) {
    actions.push({
      id: 'remove-labels',
      label: t('removeLabels'),
      meta: '⇧L',
      keywords: 'labels remove quitar sacar remover',
      placeholder: t('labelsPlaceholder'),
      icon: { kind: 'glyph', name: 'tag' },
      children: () => {
        const present = new Map<string, { id: string; name: string; color: string }>();
        for (const i of targets) for (const l of parseLabelList(i.labels)) present.set(l.id, l);
        return [...present.values()].map((l) => ({
          id: `unlabel:${l.id}`,
          label: l.name,
          icon: { kind: 'swatch' as const, color: safeHexColor(l.color, '#767676') },
          keepOpen: true,
          run: () => apply((issue) => ({ labels: parseLabelList(issue.labels).filter((x) => x.id !== l.id) })),
        }));
      },
    });
  }

  if (data.estimateScale !== 'none')
  actions.push({
    id: 'estimate',
    label: t('estimate'),
    meta: '⇧E',
    keywords: 'estimate estimación estimativa points puntos',
    placeholder: t('estimatePlaceholder'),
    icon: { kind: 'glyph', name: 'estimate' },
    // Como Linear: dígitos que eligen (1 = la primera opción…, 0 = sin estimación) y la escala del team.
    children: () => [
      // El dígito es el valor (2 = 2 puntos); en talles, su posición (1 = XS).
      ...estimateChoices(data.estimateScale).map((o, i) => {
        const key = o.label ? (i < 9 ? String(i + 1) : undefined) : o.value <= 9 ? String(o.value) : undefined;
        return {
          id: `estimate:${o.value}`,
          label: o.label ?? t('points', { count: o.value }),
          keywords: String(o.value),
          checked: Boolean(one && one.estimate === o.value),
          meta: key,
          digit: key,
          run: () => apply({ estimate: o.value }),
        };
      }),
      {
        id: 'estimate:none',
        label: t('noEstimate'),
        isNone: true,
        checked: Boolean(one && one.estimate == null),
        run: () => apply({ estimate: null }),
      },
    ],
    dynamic: (q) => {
      const n = Number(q.trim());
      if (!q.trim() || !Number.isInteger(n) || n < 0 || n > 999 || estimateChoices(data.estimateScale).some((o) => o.value === n)) return [];
      return [{ id: `estimate:${n}`, label: t('points', { count: n }), run: () => apply({ estimate: n }) }];
    },
  });

  const due = (iso: string | null, label: string, id: string): CommandAction => ({
    id,
    label,
    meta: iso ? formatDay(iso) : undefined,
    isNone: iso === null,
    icon: { kind: 'glyph', name: 'calendar' },
    checked: Boolean(one && one.due_date === iso),
    run: () => apply({ dueDate: iso }),
  });
  actions.push({
    id: 'due',
    label: t('due'),
    meta: '⇧D',
    keywords: 'due date vencimiento prazo deadline',
    placeholder: t('duePlaceholder'),
    icon: { kind: 'glyph', name: 'calendar' },
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

  const start = (iso: string | null, label: string, id: string): CommandAction => ({
    id,
    label,
    meta: iso ? formatDay(iso) : undefined,
    isNone: iso === null,
    icon: { kind: 'glyph', name: 'calendar' },
    checked: Boolean(one && (one.start_date ?? null) === iso),
    run: () => apply({ startDate: iso }),
  });
  actions.push({
    id: 'start',
    label: t('start'),
    keywords: 'start date inicio início comienzo',
    placeholder: t('duePlaceholder'),
    icon: { kind: 'glyph', name: 'calendar' },
    children: () => [
      start(data.today, t('today'), 'start:today'),
      start(addDays(data.today, 1), t('tomorrow'), 'start:tomorrow'),
      start(nextWeekday(data.today, 1, true), t('nextWeek'), 'start:nextweek'),
      start(null, t('noStart'), 'start:none'),
    ],
    dynamic: (q) => {
      const iso = parseDueQuery(q, data.today);
      return iso ? [start(iso, t('startOn', { date: formatDay(iso) }), `start:${iso}`)] : [];
    },
  });

  if (sameProject && data.cycles.length) {
    actions.push({
      id: 'cycle',
      label: t('cycle'),
      meta: '⇧C',
      keywords: 'cycle ciclo sprint set add agregar mover move',
      placeholder: t('cycle'),
      icon: { kind: 'glyph', name: 'cycle' },
      // Como Linear: el cycle activo primero (Enter lo asigna), después los próximos, y "Sin cycle" al final.
      children: () => {
        const day = (iso?: string) => (iso ?? '').slice(0, 10);
        const state = (c: CommandData['cycles'][number]) =>
          !c.start_at || !c.end_at ? 1 : day(c.start_at) <= data.today && data.today <= day(c.end_at) ? 0 : day(c.start_at) > data.today ? 1 : 2;
        const sorted = [...data.cycles].sort((a, b) => state(a) - state(b) || day(a.start_at).localeCompare(day(b.start_at)));
        return [
          ...sorted.map((c) => ({
            id: `cycle:${c.id}`,
            label: c.name,
            meta: state(c) === 0 ? t('currentCycle') : state(c) === 1 && c.start_at ? t('upcomingCycle') : undefined,
            icon: { kind: 'glyph' as const, name: 'cycle' as const },
            checked: Boolean(one && one.cycle_id === c.id),
            run: () => apply({ cycleId: c.id }),
          })),
          { id: 'cycle:none', label: t('noCycle'), isNone: true, checked: Boolean(one && !one.cycle_id), run: () => apply({ cycleId: null }) },
        ];
      },
    });
  }
  if (sameProject) {
    for (const c of data.cycles) {
      flat.push({
        id: `flat-cycle:${c.id}`,
        label: t('addToCycle', { name: c.name }),
        keywords: `cycle ciclo sprint ${c.name}`,
        icon: { kind: 'glyph', name: 'cycle' },
        searchOnly: true,
        run: () => apply({ cycleId: c.id }),
      });
    }
  }
  // Milestone: uno solo visible, como Linear. Con project, los milestones del
  // project; sin project, los del team.
  const planOf = targets.every((i) => i.plan_id && i.plan_id === targets[0].plan_id) ? (targets[0].plan_id ?? null) : null;
  if (planOf || (sameProject && data.milestones.length)) {
    actions.push({
      id: 'milestone',
      label: t('milestone'),
      keywords: 'milestone hito marco',
      placeholder: t('milestone'),
      icon: { kind: 'glyph', name: 'milestone' },
      children: () => [
        ...(planOf
          ? []
          : data.milestones.map((m) => ({
              id: `milestone:${m.id}`,
              label: m.name,
              icon: { kind: 'glyph' as const, name: 'milestone' as const },
              checked: Boolean(one && one.milestone_id === m.id),
              run: () => apply({ milestoneId: m.id }),
            }))),
        {
          id: 'milestone:none',
          label: t('noMilestone'),
          isNone: true,
          checked: Boolean(one && !(planOf ? one.plan_milestone_id : one.milestone_id)),
          run: () => apply(planOf ? { planMilestoneId: null } : { milestoneId: null }),
        },
      ],
      load: planOf
        ? async () => {
            const res = await fetch(`/api/track/plans/${planOf}`).catch(() => null);
            const rows = res?.ok ? ((await res.json()) as { milestones?: Array<{ id: string; name: string; target_date?: string | null }> }).milestones ?? [] : [];
            return rows.map((m) => ({
              id: `plan-milestone:${m.id}`,
              label: m.name,
              meta: m.target_date ? formatDay(m.target_date.slice(0, 10)) : undefined,
              icon: { kind: 'glyph' as const, name: 'milestone' as const },
              checked: Boolean(one && one.plan_milestone_id === m.id),
              run: () => apply({ planMilestoneId: m.id }),
            }));
          }
        : undefined,
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
      icon: { kind: 'glyph', name: 'team' },
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
            keywords: r.slug,
            run: () => move(targets, r.id),
          }));
      },
    });
  }

  // Jerarquía: elegir padre (búsqueda en el servidor), sacarlo, crear sub-issue.
  const targetIds = new Set(targets.map((i) => i.id));
  const searchIssues = async (q: string): Promise<TrackIssueWithStatus[]> => {
    const sp = new URLSearchParams({ pageSize: '12' });
    if (q.trim()) sp.set('q', q.trim());
    const res = await fetch(`/api/track/issues?${sp.toString()}`).catch(() => null);
    if (!res?.ok) return [];
    return ((await res.json()) as { rows: TrackIssueWithStatus[] }).rows.filter((r) => !targetIds.has(r.id));
  };
  actions.push({
    id: 'parent',
    label: t('setParent'),
    meta: '⌘⇧P',
    keywords: 'parent padre pai sub-issue subissue convert',
    placeholder: t('searchParent'),
    icon: { kind: 'glyph', name: 'parent' },
    children: () => [],
    load: async (q) =>
      (await searchIssues(q)).map((r) => ({
        id: `parent:${r.id}`,
        label: `${r.identifier} ${r.title}`,
        icon: { kind: 'status' as const, color: r.status_color ?? null, category: r.status_category ?? null },
        checked: Boolean(one && one.parent_id === r.id),
        run: () => apply({ parentId: r.id }),
      })),
  });
  if (targets.some((i) => i.parent_id)) {
    actions.push({
      id: 'remove-parent',
      label: t('removeParent'),
      keywords: 'parent padre quitar remove',
      icon: { kind: 'glyph', name: 'parent' },
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
      icon: { kind: 'glyph', name: 'subissue' },
      run: () => create(one),
    });
  }
  if (one && handlers.markDuplicate) {
    const mark = handlers.markDuplicate;
    actions.push({
      id: 'duplicate',
      label: t('markDuplicate'),
      keywords: 'duplicate duplicado duplicata mark marcar',
      placeholder: t('searchDuplicate'),
      icon: { kind: 'glyph', name: 'duplicate' },
      children: () => [],
      load: async (q) =>
        (await searchIssues(q)).map((r) => ({
          id: `duplicate:${r.id}`,
          label: `${r.identifier} ${r.title}`,
          icon: { kind: 'status' as const, color: r.status_color ?? null, category: r.status_category ?? null },
          run: () => mark(one, r),
        })),
    });
  }
  if (one && handlers.subscription) {
    const sub = handlers.subscription;
    const on = sub.subscribed();
    actions.push({
      id: 'subscribe',
      label: on ? t('unsubscribe') : t('subscribe'),
      meta: '⇧S',
      keywords: 'subscribe suscribir notifications avisos inscrever',
      icon: { kind: 'glyph', name: 'bell' },
      run: () => sub.toggle(),
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
        icon: { kind: 'glyph', name: 'copy' },
        run: () => copy(one.identifier, one.identifier),
      },
      {
        id: 'copy-link',
        label: t('copyLink'),
        meta: '⌘⇧,',
        keywords: 'copy copiar link url',
        icon: { kind: 'glyph', name: 'link' },
        run: () => copy(new URL(issueHref(one), window.location.origin).toString(), t('link')),
      },
      {
        id: 'copy-branch',
        label: t('copyBranch'),
        meta: '⌘⇧.',
        keywords: 'copy copiar git branch rama',
        icon: { kind: 'glyph', name: 'copy' },
        run: () => {
          const branch = branchNameFor(one.identifier, one.title);
          copy(branch, branch);
        },
      },
    );
    if (handlers.open) {
      const open = handlers.open;
      actions.push({ id: 'open', label: t('open'), meta: '↵', keywords: 'open abrir', icon: { kind: 'glyph', name: 'open' }, run: () => open(one) });
    }
  }
  if (handlers.archive && targets.every((i) => !i.archived_at)) {
    const archive = handlers.archive;
    actions.push({
      id: 'archive',
      label: targets.length > 1 ? t('archiveMany', { count: targets.length }) : t('archive'),
      keywords: 'archive archivar arquivar',
      icon: { kind: 'glyph', name: 'archive' },
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
      icon: { kind: 'glyph', name: 'trash' },
      run: () => remove(targets),
    });
  }
  return [...actions, ...flat];
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
  // El cursor de J/K va por id (kbCursor) y sobrevive a que la fila se re-monte.
  const kb = activeRowElement();
  if (kb?.dataset.issueKey) return kb.dataset.issueKey;
  const row =
    document.querySelector<HTMLElement>('[data-issue-key].is-kb-active') ??
    document.querySelector<HTMLElement>('[data-issue-key]:hover');
  return row?.dataset.issueKey ?? null;
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** ¿El foco está donde se escribe? Un checkbox o un botón de la barra no cuentan (los atajos siguen). */
export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  if (node.isContentEditable || node.closest('textarea, select, [contenteditable="true"]')) return true;
  const input = node.closest('input') as HTMLInputElement | null;
  return Boolean(input && !NON_TEXT_INPUTS.has((input.type || 'text').toLowerCase()));
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
    if (e.shiftKey && (key === ',' || key === '<' || e.code === 'Comma')) return { run: 'copy-link' };
    if (e.shiftKey && (key === 'd' || e.code === 'KeyD')) return { run: 'due:clear' };
    if (!e.shiftKey && (key === 'backspace' || key === 'delete')) return { run: 'delete' };
    return null;
  }
  if (e.shiftKey) {
    if (e.code === 'KeyE' || key === 'e') return { page: 'estimate' };
    if (e.code === 'KeyD' || key === 'd') return { page: 'due' };
    if (e.code === 'KeyC' || key === 'c') return { page: 'cycle' };
    if (e.code === 'KeyP' || key === 'p') return { page: 'project' };
    if (e.code === 'KeyL' || key === 'l') return { page: 'remove-labels' };
    if (e.code === 'KeyS' || key === 's') return { run: 'subscribe' };
    const digit = /^Digit([0-4])$/.exec(e.code ?? '');
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
  /** Chip donde anclar el menú de un atajo (S abre el menú bajo el estado del panel, como Linear). */
  anchorFor?: (page: string, targets: TrackIssueWithStatus[]) => Element | null;
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
    // Abierta desde un chip o el menú "…" de una fila: fija ese issue (o la fila/issue de siempre).
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenCommandDetail | undefined>).detail;
      const o = ref.current;
      if (detail?.targetId) {
        const hit = o.lookup?.(detail.targetId);
        if (hit) {
          pin([hit]);
          return;
        }
      }
      if (!pinned) pin(o.getTargets());
    };
    window.addEventListener('keydown', onCmdK, true);
    window.addEventListener(CMDK_CLOSED_EVENT, onClosed);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
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
        openCommandMenu(sc.page, { anchor: o.anchorFor?.(sc.page, targets) ?? null });
        return;
      }
      if (sc.run.startsWith('priority:')) {
        // ⇧0 sin prioridad, ⇧1 urgente … ⇧4 baja (el orden del menú de Linear).
        const p = PRIORITY_MENU_ORDER[Number(sc.run.slice(9))];
        if (!p) return;
        e.preventDefault();
        o.handlers.apply(targets, { priority: p });
        return;
      }
      // ⌘⇧O con varios seleccionados: como Linear, elegir de qué issue pasan a ser sub-issues.
      if (sc.run === 'sub-issue' && targets.length > 1) {
        e.preventDefault();
        pin(targets);
        openCommandMenu('parent');
        return;
      }
      if (sc.run === 'due:clear') {
        e.preventDefault();
        o.handlers.apply(targets, { dueDate: null });
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
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, [enabled]);
}
