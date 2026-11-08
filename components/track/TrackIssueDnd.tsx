'use client';

/**
 * Arrastrar issues como en Linear, para todas las vistas de Track a la vez
 * (lista, board, Mis issues, Issues): una sola capa que escucha el documento.
 *
 * - Origen: cualquier fila o card con data-issue-row + data-issue-key. Si la
 *   fila está seleccionada (X, Shift o ⌘ clic) se arrastra toda la selección,
 *   con un fantasma que dice "N issues".
 * - Destinos: data-track-drop="team:<id>" (mover de team: identificador nuevo,
 *   el viejo sigue resolviendo, estado equivalente, sin cycle ni labels del
 *   team anterior), "plan:<id>" (project), "status:", "priority:", "cycle:",
 *   "assignee:", "planMilestone:" (grupos de la lista) y, con orden Manual, otra fila (reordenar).
 * - Cada cambio deja Deshacer en el toast (y ⌘Z). Mover de team deshace con el
 *   mismo identificador de antes.
 * - Auto-scroll cerca de los bordes; un team cerrado del sidebar se abre si se
 *   sostiene el arrastre encima.
 * - Clic derecho en una fila (o mantener apretado en pantallas táctiles) abre el
 *   menú del issue: cada opción abre esa página de ⌘K sobre el issue.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { openCommandMenu } from '@/lib/cmdk-context';
import { pushNotice, pushUndo, scheduleDelete } from './trackUndo';
import { branchNameFor } from '@/lib/track-branch';
import { TRACK_ISSUES_CHANGED } from './TrackBranch';

export const ISSUES_DRAG_TYPE = 'application/x-track-issues';
const ROW = '[data-issue-row][data-issue-key]';
const EDGE = 56;

type IssueSnapshot = {
  id: string;
  identifier: string;
  project_id: string;
  status_id: string | null;
  priority: string;
  assignee_id: string | null;
  cycle_id: string | null;
  milestone_id?: string | null;
  plan_id: string | null;
  plan_milestone_id?: string | null;
  sub_order?: number | null;
  labels: string;
};

interface MenuState {
  x: number;
  y: number;
  id: string;
  selected: boolean;
}

const MENU_PAGES = ['status', 'assignee', 'priority', 'labels', 'project', 'cycle', 'move-team', 'estimate', 'due'] as const;
/** Atajo de cada opción, como en el menú contextual de Linear. */
const MENU_KEYS: Record<string, string> = {
  status: 'S',
  assignee: 'A',
  priority: 'P',
  labels: 'L',
  project: '⇧P',
  cycle: '⇧C',
  'move-team': '⌘⇧M',
  estimate: '⇧E',
  due: '⇧D',
  copyId: '⌘.',
  copyLink: '⌘⇧,',
  copyBranch: '⌘⇧.',
  delete: '⌘⌫',
};

async function json<T>(res: Response | null): Promise<T | null> {
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

function getIssue(id: string) {
  return fetch(`/api/track/issues/${id}`, { cache: 'no-store' })
    .catch(() => null)
    .then((r) => json<IssueSnapshot>(r));
}

function patchIssue(id: string, body: Record<string, unknown>) {
  return fetch(`/api/track/issues/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .catch(() => null)
    .then((r) => json<IssueSnapshot>(r));
}

function moveIssue(id: string, teamId: string, identifier?: string) {
  return fetch(`/api/track/issues/${id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, identifier }),
  })
    .catch(() => null)
    .then((r) => json<IssueSnapshot & { droppedLabels?: string[] }>(r));
}

function changed() {
  window.dispatchEvent(new CustomEvent(TRACK_ISSUES_CHANGED));
}

/** Filas seleccionadas del mismo contenedor (lista o board) que la fila arrastrada. */
function selectedIds(row: HTMLElement): string[] {
  const scope = row.closest('table, .track-groups, .track-board, [data-testid="track-issues"]') ?? document;
  return [...scope.querySelectorAll<HTMLElement>(`${ROW}.is-selected`)].map((el) => el.dataset.issueKey!).filter(Boolean);
}

function scrollParent(el: Element | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

export default function TrackIssueDnd() {
  const t = useTranslations('track.dnd');
  const drag = useRef<{ ids: string[]; target: HTMLElement | null; hoverAt: number; place: 'before' | 'after' } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const clearTarget = () => {
    const d = drag.current;
    d?.target?.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
    if (d) d.target = null;
  };

  const run = useCallback(
    async (ids: string[], dest: string, row: HTMLElement | null, place: 'before' | 'after') => {
      const [kind, value] = [dest.slice(0, dest.indexOf(':')), dest.slice(dest.indexOf(':') + 1)];
      const before = (await Promise.all(ids.map(getIssue))).filter((x): x is IssueSnapshot => !!x);
      if (!before.length) return;
      const one = before.length === 1 ? before[0].identifier : '';

      if (kind === 'team') {
        const moving = before.filter((b) => b.project_id !== value);
        if (!moving.length) return;
        const after = await Promise.all(moving.map((b) => moveIssue(b.id, value)));
        const ok = moving.map((b, i) => ({ b, a: after[i] })).filter((x) => !!x.a) as Array<{ b: IssueSnapshot; a: IssueSnapshot & { droppedLabels?: string[] } }>;
        changed();
        if (!ok.length) {
          pushUndo(t('moveFailed'), () => undefined, undefined);
          return;
        }
        const name = document.querySelector<HTMLElement>(`[data-track-drop="team:${CSS.escape(value)}"]`)?.dataset.trackDropName ?? '';
        const dropped = [...new Set(ok.flatMap((x) => x.a.droppedLabels ?? []))];
        const label =
          (ok.length === 1 ? t('movedOne', { from: ok[0].b.identifier, to: ok[0].a.identifier, team: name }) : t('movedMany', { count: ok.length, team: name })) +
          (dropped.length ? ` ${t('labelsDropped', { labels: dropped.join(', ') })}` : '');
        pushUndo(
          label,
          async () => {
            for (const { b } of ok) {
              await moveIssue(b.id, b.project_id, b.identifier);
              // Mover de team saca el cycle, el milestone del team y sus labels: deshacer los devuelve.
              const restore: Record<string, unknown> = {};
              if (b.cycle_id) restore.cycleId = b.cycle_id;
              if (b.milestone_id) restore.milestoneId = b.milestone_id;
              if (dropped.length) restore.labels = JSON.parse(b.labels || '[]');
              if (Object.keys(restore).length) await patchIssue(b.id, restore);
            }
            changed();
          },
          async () => {
            for (const { b } of ok) await moveIssue(b.id, value);
            changed();
          },
        );
        return;
      }

      if (kind === 'row') {
        // Reordenar (orden Manual): entre la fila de arriba y la de abajo, renumerando las de arriba sin orden.
        const scope = row?.closest('table, .track-groups, .track-board') ?? document;
        const rows = [...scope.querySelectorAll<HTMLElement>(ROW)].filter((el) => !ids.includes(el.dataset.issueKey!));
        const at = rows.findIndex((el) => el.dataset.issueKey === value) + (place === 'after' ? 1 : 0);
        const order = (el: HTMLElement | undefined) => (el?.dataset.sortOrder ? Number(el.dataset.sortOrder) : null);
        const patches: Array<[string, number]> = [];
        let prev = order(rows[at - 1]);
        if (at > 0 && prev === null) {
          rows.slice(0, at).forEach((el, i) => patches.push([el.dataset.issueKey!, (i + 1) * 1024]));
          prev = at * 1024;
        }
        const next = order(rows[at]);
        const lo = prev ?? (next !== null ? next - 1024 * (ids.length + 1) : 0);
        const hi = next ?? lo + 1024 * (ids.length + 1);
        before.forEach((b, i) => patches.push([b.id, lo + ((hi - lo) * (i + 1)) / (before.length + 1)]));
        // Soltar sobre una fila de otro grupo de status también cambia el status, como Linear.
        const group = row?.closest<HTMLElement>('[data-track-drop^="status:"]')?.dataset.trackDrop?.slice(7);
        await Promise.all(patches.map(([id, subOrder]) => patchIssue(id, { subOrder, ...(group && ids.includes(id) ? { statusId: group } : {}) })));
        changed();
        pushUndo(one ? t('reordered', { id: one }) : t('updatedMany', { count: before.length }), async () => {
          await Promise.all(before.map((b) => patchIssue(b.id, { subOrder: b.sub_order ?? null, statusId: b.status_id })));
          changed();
        });
        return;
      }

      const field: Record<string, [string, (b: IssueSnapshot) => unknown]> = {
        plan: ['planId', (b) => b.plan_id],
        planMilestone: ['planMilestoneId', (b) => b.plan_milestone_id ?? null],
        status: ['statusId', (b) => b.status_id],
        priority: ['priority', (b) => b.priority],
        cycle: ['cycleId', (b) => b.cycle_id],
        assignee: ['assigneeId', (b) => b.assignee_id],
      };
      const f = field[kind];
      if (!f) return;
      const next = value === 'none' ? null : value;
      const todo = before.filter((b) => f[1](b) !== next);
      if (!todo.length) return;
      await Promise.all(todo.map((b) => patchIssue(b.id, { [f[0]]: next })));
      changed();
      const name = kind === 'plan' ? (document.querySelector<HTMLElement>(`[data-track-drop="plan:${CSS.escape(value)}"]`)?.dataset.trackDropName ?? '') : '';
      const label =
        kind === 'plan'
          ? todo.length === 1
            ? t('addedToProject', { id: todo[0].identifier, name })
            : t('addedManyToProject', { count: todo.length, name })
          : todo.length === 1
            ? t('updatedOne', { id: todo[0].identifier })
            : t('updatedMany', { count: todo.length });
      pushUndo(
        label,
        async () => {
          await Promise.all(todo.map((b) => patchIssue(b.id, { [f[0]]: f[1](b) })));
          changed();
        },
        async () => {
          await Promise.all(todo.map((b) => patchIssue(b.id, { [f[0]]: next })));
          changed();
        },
      );
    },
    [t],
  );

  useEffect(() => {
    // Filas arrastrables (las de la lista no lo son por sí solas); sus links no se arrastran sueltos.
    const onOver = (e: MouseEvent) => {
      const row = (e.target as Element | null)?.closest?.<HTMLElement>(ROW);
      if (!row || row.draggable || row.closest('[data-track-no-drag]')) return;
      row.draggable = true;
      row.querySelectorAll('a, img').forEach((a) => ((a as HTMLElement).draggable = false));
    };

    const onStart = (e: DragEvent) => {
      const row = (e.target as Element | null)?.closest?.<HTMLElement>(ROW);
      if (!row || !e.dataTransfer) return;
      const id = row.dataset.issueKey!;
      const selected = row.classList.contains('is-selected') ? selectedIds(row) : [];
      const ids = selected.includes(id) ? selected : [id];
      drag.current = { ids, target: null, hoverAt: 0, place: 'after' };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(ISSUES_DRAG_TYPE, JSON.stringify(ids));
      if (!e.dataTransfer.types.includes('text/plain')) e.dataTransfer.setData('text/plain', row.dataset.issueIdentifier ?? id);
      const ghost = document.createElement('div');
      ghost.className = 'track-drag-ghost';
      ghost.textContent = ids.length === 1 && row.dataset.issueIdentifier ? row.dataset.issueIdentifier : t('count', { count: ids.length });
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 10);
      window.setTimeout(() => ghost.remove(), 0);
      document.body.classList.add('track-dragging');
    };

    const onDragOver = (e: DragEvent) => {
      const d = drag.current;
      if (!d) return;
      // Auto-scroll cerca de los bordes (de la ventana y del contenedor con scroll).
      const sp = scrollParent(e.target as Element);
      const box = sp?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      const dy = e.clientY < box.top + EDGE ? -18 : e.clientY > box.bottom - EDGE ? 18 : 0;
      if (dy) {
        if (sp) sp.scrollTop += dy;
        else window.scrollBy(0, dy);
      }

      const el = e.target as Element | null;
      let target = el?.closest?.<HTMLElement>('[data-track-drop]') ?? null;
      const row = el?.closest?.<HTMLElement>(ROW) ?? null;
      const manual = row?.closest('[data-track-sort="manual"]');
      if (row && manual && !d.ids.includes(row.dataset.issueKey!)) target = row;
      if (target !== d.target) {
        clearTarget();
        d.target = target;
        d.hoverAt = Date.now();
        target?.classList.add('is-drop-target');
      }
      if (!target) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (target === row) {
        const r = row.getBoundingClientRect();
        d.place = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
        row.classList.toggle('is-drop-before', d.place === 'before');
        row.classList.toggle('is-drop-after', d.place === 'after');
      }
      // Sostener sobre un team cerrado del sidebar lo abre (para soltar en uno de sus projects).
      if (target.dataset.trackDrop?.startsWith('team:') && Date.now() - d.hoverAt > 700) {
        const toggle = target.querySelector<HTMLButtonElement>('[aria-expanded="false"]');
        d.hoverAt = Number.POSITIVE_INFINITY;
        toggle?.click();
      }
    };

    const onDrop = (e: DragEvent) => {
      const d = drag.current;
      if (!d?.target) return;
      e.preventDefault();
      e.stopPropagation();
      const target = d.target;
      const dest = target.matches(ROW) ? `row:${target.dataset.issueKey}` : target.dataset.trackDrop!;
      const { ids, place } = d;
      clearTarget();
      void run(ids, dest, target.matches(ROW) ? target : null, place);
    };

    const onEnd = () => {
      clearTarget();
      drag.current = null;
      document.body.classList.remove('track-dragging');
    };

    // ⌘/Ctrl + clic en una fila la suma a la selección (como Linear), sin abrirla.
    const onClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return;
      const el = e.target as Element | null;
      const row = el?.closest?.<HTMLElement>(ROW);
      if (!row || el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (!box) return;
      e.preventDefault();
      e.stopPropagation();
      box.click();
    };

    const openMenu = (row: HTMLElement, x: number, y: number) => {
      setMenu({ x, y, id: row.dataset.issueKey!, selected: row.classList.contains('is-selected') });
    };
    const onContext = (e: MouseEvent) => {
      const row = (e.target as Element | null)?.closest?.<HTMLElement>(ROW);
      if (!row || (e.target as Element).closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      openMenu(row, e.clientX, e.clientY);
    };
    // Pantallas táctiles: mantener apretada una fila abre el mismo menú (no hay arrastre al sidebar).
    let press = 0;
    const onTouchStart = (e: TouchEvent) => {
      const row = (e.target as Element | null)?.closest?.<HTMLElement>(ROW);
      if (!row || e.touches.length !== 1) return;
      const { clientX, clientY } = e.touches[0];
      press = window.setTimeout(() => openMenu(row, clientX, clientY), 550);
    };
    const cancelPress = () => window.clearTimeout(press);

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('dragstart', onStart, true);
    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('dragend', onEnd, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onContext);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', cancelPress, { passive: true });
    document.addEventListener('touchend', cancelPress);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('dragstart', onStart, true);
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('dragend', onEnd, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('contextmenu', onContext);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', cancelPress);
      document.removeEventListener('touchend', cancelPress);
      cancelPress();
    };
  }, [run, t]);

  // Menú: foco en la primera opción, flechas, Esc cierra, clic afuera cierra.
  useEffect(() => {
    if (!menu) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenu(null);
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [menu]);

  if (!menu) return null;
  const pick = (page?: string) => {
    const m = menu;
    setMenu(null);
    // Sobre la selección si la fila está seleccionada; si no, solo sobre esa fila.
    window.setTimeout(() => openCommandMenu(page, m.selected ? {} : { targetId: m.id }), 0);
  };
  const copy = (what: 'id' | 'link' | 'branch') => {
    const m = menu;
    const row = document.querySelector<HTMLElement>(`[data-issue-key="${CSS.escape(m.id)}"]`);
    const ident = row?.dataset.issueIdentifier ?? m.id;
    setMenu(null);
    if (what === 'branch') {
      void getIssue(m.id).then((i) => i && navigator.clipboard?.writeText(branchNameFor(i.identifier, (i as IssueSnapshot & { title?: string }).title ?? '')));
      return;
    }
    void navigator.clipboard?.writeText(what === 'id' ? ident : `${window.location.origin}/app/track/issue/${ident}`).catch(() => undefined);
  };
  // Borrar con la ventana de Deshacer de siempre; si no hay permiso (miembro), avisa y vuelve a mostrarlo.
  const remove = () => {
    const m = menu;
    setMenu(null);
    const ids = m.selected ? [...document.querySelectorAll<HTMLElement>(`${ROW}.is-selected`)].map((el) => el.dataset.issueKey!) : [m.id];
    const row = document.querySelector<HTMLElement>(`[data-issue-key="${CSS.escape(m.id)}"]`);
    scheduleDelete({
      ids,
      label: ids.length === 1 ? t('deleted', { id: row?.dataset.issueIdentifier ?? '' }) : t('deletedMany', { count: ids.length }),
      commit: async (keepalive) => {
        const res = await Promise.all(ids.map((id) => fetch(`/api/track/issues/${id}`, { method: 'DELETE', keepalive }).catch(() => null)));
        if (res.some((r) => r?.status === 403)) pushNotice(t('deleteNotAllowed'));
        changed();
      },
      restore: changed,
    });
    changed();
  };
  const left = Math.min(menu.x, window.innerWidth - 240);
  const top = Math.min(menu.y, window.innerHeight - 420);
  return (
    <div ref={menuRef} className="track-context-menu" role="menu" aria-label={t('menu.label')} style={{ left: Math.max(8, left), top: Math.max(8, top) }} data-testid="track-context-menu">
      {MENU_PAGES.map((p) => (
        <button key={p} type="button" role="menuitem" className="track-context-item" onClick={() => pick(p)}>
          <span>{t(`menu.${p}`)}</span>
          <kbd className="track-context-key">{MENU_KEYS[p]}</kbd>
        </button>
      ))}
      <hr className="track-context-sep" />
      <button type="button" role="menuitem" className="track-context-item" onClick={() => copy('id')}>
        <span>{t('menu.copyId')}</span>
        <kbd className="track-context-key">{MENU_KEYS.copyId}</kbd>
      </button>
      <button type="button" role="menuitem" className="track-context-item" onClick={() => copy('link')}>
        <span>{t('menu.copyLink')}</span>
        <kbd className="track-context-key">{MENU_KEYS.copyLink}</kbd>
      </button>
      <button type="button" role="menuitem" className="track-context-item" onClick={() => copy('branch')}>
        <span>{t('menu.copyBranch')}</span>
        <kbd className="track-context-key">{MENU_KEYS.copyBranch}</kbd>
      </button>
      <button type="button" role="menuitem" className="track-context-item" onClick={() => pick()}>
        <span>{t('menu.more')}</span>
      </button>
      <hr className="track-context-sep" />
      <button type="button" role="menuitem" className="track-context-item is-danger" onClick={remove} data-testid="track-context-delete">
        <span>{t('menu.delete')}</span>
        <kbd className="track-context-key">{MENU_KEYS.delete}</kbd>
      </button>
    </div>
  );
}
