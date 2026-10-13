'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import QuickIssueModal from './QuickIssueModal';
import { useToday } from './InlineEditors';
import { buildTrackUiLabels } from './ui-labels';
import { openTrackNewIssue, TRACK_NEW_ISSUE_EVENT, type IssueDraft, type ProjectContext } from './useIssueStore';

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== 'function') return false;
  return (
    node.isContentEditable ||
    Boolean(
      node.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]',
      ),
    )
  );
}

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
  const activeRow = useRef<HTMLElement | null>(null);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        window.setTimeout(() => {
          if (!e.defaultPrevented) void openModal();
        }, 0);
        return;
      }
      if (key === 'j' || key === 'k') {
        const rows = issueRows();
        if (rows.length === 0) return;
        e.preventDefault();
        const cur = activeRow.current ? rows.indexOf(activeRow.current) : -1;
        const next = cur === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, cur + (key === 'j' ? 1 : -1)));
        activeRow.current?.classList.remove('is-kb-active');
        activeRow.current?.removeAttribute('aria-current');
        const row = rows[next];
        row.classList.add('is-kb-active');
        row.setAttribute('aria-current', 'true');
        row.scrollIntoView({ block: 'nearest' });
        activeRow.current = row;
        return;
      }
      if (e.key === 'Enter' && activeRow.current && document.contains(activeRow.current)) {
        const href = activeRow.current.dataset.href;
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

  // La fila activa se pierde al navegar.
  useEffect(() => {
    activeRow.current = null;
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
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(t('inline.createError'));
      return;
    }
    const issue = (await res.json()) as { id: string };
    router.push(`/app/track/issues/${issue.id}`);
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
          onCreate={(projectId, draft) => void create(projectId, draft)}
          labels={ui}
          today={today}
        />
      )}
      {error && (
        <p className="form-error track-shortcut-error" role="alert" onClick={() => setError(null)}>
          {error}
        </p>
      )}
    </>
  );
}
