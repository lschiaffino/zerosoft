'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import dynamic from 'next/dynamic';
import { isTypingTarget as isTextTarget, markGoPending } from './trackCommands';
import { activeRowElement, installCursor, moveActive, resetCursor } from './kbCursor';
import { TrackToast, useToday } from './InlineEditors';
import { buildTrackUiLabels } from './ui-labels';
import { openTrackNewIssue, TRACK_NEW_ISSUE_EVENT, type IssueDraft, type ProjectContext } from './useIssueStore';

// El alta rápida (con el editor visual) se baja aparte y se precarga en reposo.
const loadQuickIssueModal = () => import('./QuickIssueModal');
const QuickIssueModal = dynamic(loadQuickIssueModal);

// Teclas dentro de un campo de texto o de un menú/diálogo no son atajos. Un
// checkbox o un botón de la barra no cuentan como tipeo (bug: J/G dejaban de
// andar después de tildar "Show sub-issues").
function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return isTextTarget(node) || Boolean(node.closest('dialog, [role="dialog"], [role="menu"], [role="listbox"]'));
}

/** G + tecla: a dónde lleva (Linear: G I inbox, G M my issues, G E all issues, G P projects, G S settings, G T triage, G C cycles). */
export const GO_TARGETS: Record<string, string> = {
  i: '/app/track/inbox',
  m: '/app/track/my-tasks',
  e: '/app/track/issues',
  p: '/app/track/projects',
  s: '/app/track/settings',
  o: '/app/track',
  c: '/app/track/cycles',
  t: '/app/track/triage',
};

function issueRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-issue-row]')).filter(
    (el) => el.offsetParent !== null,
  );
}

/**
 * Atajos globales de Track (montado en el layout de /app/track):
 * - C: nuevo issue en contexto. Si la vista activa tiene su propio modal
 *   (proyecto, My tasks, Issues) lo maneja ella (preventDefault); si no, se
 *   abre este modal, con el proyecto del issue abierto preseleccionado.
 * - J / K: mueve la fila activa en las listas de issues; Enter la abre.
 * - G y una tecla: navegar (I inbox, M mis tareas, E issues, P proyectos, S ajustes, O overview).
 */
export default function TrackShortcuts() {
  const t = useTranslations('track');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = useToday();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectContext[] | null>(null);
  const [contextProjectId, setContextProjectId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const goPending = useRef(0);

  const openModal = useCallback(async () => {
    const ctx = document.querySelector<HTMLElement>('[data-track-project-id]')?.dataset.trackProjectId;
    setContextProjectId(ctx);
    setError(null);
    if (!projects) {
      const res = await fetch('/api/track/projects?meta=1').catch(() => null);
      const data = res?.ok ? ((await res.json()) as { rows: ProjectContext[] }) : { rows: [] };
      setProjects(data.rows);
    }
    setOpen(true);
  }, [projects]);

  // Si una vista ya manejó el atajo/evento (preventDefault), no hacemos nada:
  // revisamos después de que el evento terminó de despacharse.
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const run = () => void loadQuickIssueModal().catch(() => undefined);
    if (idle) idle(run);
    else window.setTimeout(run, 1500);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"], dialog[open]')) return;
      const key = e.key.toLowerCase();
      // G y después una tecla navega, como en Linear (G I inbox, G M mis tareas…).
      if (goPending.current && Date.now() - goPending.current < 1200 && !e.shiftKey) {
        goPending.current = 0;
        markGoPending(0);
        let target = GO_TARGETS[key];
        if (target) {
          e.preventDefault();
          // G T: el triage del team que se está mirando (la página resuelve el primero si no hay).
          const team = document.querySelector<HTMLElement>('[data-track-project-id]')?.dataset.trackProjectId;
          if (key === 't' && team) target = `${target}?team=${encodeURIComponent(team)}`;
          if (key === 'c' && team) target = `${target}?team=${encodeURIComponent(team)}`;
          router.push(target);
        }
        return;
      }
      if (key === 'g' && !e.shiftKey) {
        goPending.current = Date.now();
        markGoPending(goPending.current);
        return;
      }
      if (key === 'c' && !e.shiftKey) {
        window.setTimeout(() => {
          if (!e.defaultPrevented) void openModal();
        }, 0);
        return;
      }
      if (key === 'j' || key === 'k') {
        if (issueRows().length === 0) return;
        e.preventDefault();
        // El cursor va por id de issue (kbCursor): sigue a la fila aunque cambie de grupo.
        moveActive(key === 'j' ? 1 : -1);
        return;
      }
      const active = activeRowElement();
      if (e.key === 'Enter' && active) {
        const href = active.dataset.href;
        if (href && (e.target === document.body || e.target === document.documentElement)) {
          e.preventDefault();
          router.push(href);
        }
      }
    };
    const onEvent = (e: Event) => {
      window.setTimeout(() => {
        if (!e.defaultPrevented) void openModal();
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(TRACK_NEW_ISSUE_EVENT, onEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(TRACK_NEW_ISSUE_EVENT, onEvent);
    };
  }, [openModal, router]);

  // El cursor sigue al issue en cada render (S, P, A, ⌘Z, borrados); se suelta al navegar.
  useEffect(() => installCursor(), []);
  useEffect(() => {
    resetCursor();
  }, [pathname]);

  // ?newIssue=1 (desde ⌘K fuera de Track) → abre el modal y limpia el parámetro.
  useEffect(() => {
    if (searchParams.get('newIssue') !== '1') return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('newIssue');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    window.setTimeout(openTrackNewIssue, 50);
  }, [searchParams, pathname, router]);

  async function create(projectId: string, draft: IssueDraft) {
    const res = await fetch(`/api/track/projects/${projectId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: draft.title,
        description: draft.description?.trim() ? [{ type: 'text', text: draft.description.trim() }] : [],
        statusId: draft.statusId || undefined,
        priority: draft.priority,
        assigneeId: draft.assigneeId || undefined,
        dueDate: draft.dueDate || undefined,
        // El borrador completo del composer (chips), igual que useIssueStore.create.
        startDate: draft.startDate || undefined,
        parentId: draft.parentId || undefined,
        cycleId: draft.cycleId || undefined,
        milestoneId: draft.milestoneId || undefined,
        estimate: draft.estimate ?? undefined,
        planId: draft.planId || undefined,
        labels: draft.labels?.length ? draft.labels : undefined,
        triage: (draft as IssueDraft & { triage?: boolean }).triage ? true : undefined,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(t('inline.createError'));
      return;
    }
    const issue = (await res.json()) as { id: string };
    router.push(`/app/track/issues/${issue.id}`);
    return issue;
  }

  const ui = buildTrackUiLabels((k) => t(k));

  return (
    <>
      {projects && projects.length > 0 && (
        <QuickIssueModal
          open={open}
          onClose={() => setOpen(false)}
          projects={projects}
          defaults={contextProjectId ? { projectId: contextProjectId } : undefined}
          onCreate={(projectId, draft) => create(projectId, draft)}
          labels={ui}
          today={today}
        />
      )}
      <TrackToast message={error} onDismiss={() => setError(null)} dismissLabel={ui.inline.dismiss} />
    </>
  );
}
