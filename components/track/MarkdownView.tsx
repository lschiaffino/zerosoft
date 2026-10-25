'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';
import { renderTrackMarkdown } from '@/lib/track-markdown';
import { mentionLabel, refCache, rememberMembers, resolveRefs, statusGlyph } from './issueRefs';

export interface MarkdownLabels {
  write: string;
  preview: string;
  toolbar: string;
  bold: string;
  italic: string;
  code: string;
  list: string;
  link: string;
  /** Texto que se inserta cuando no hay selección (negrita, link…). */
  placeholderText: string;
  emptyPreview: string;
  hint: string;
}

/**
 * Markdown renderizado (sanitizado en lib/track-markdown). Las referencias a
 * issues (ZER-12 o un link a un issue) se completan con su estado y título y
 * llevan al issue; con `onToggleTask` los checkboxes se pueden tildar.
 */
export function MarkdownView({
  source,
  className = '',
  onToggleTask,
  members,
}: {
  source: string;
  className?: string;
  onToggleTask?: (index: number) => void;
  /** Personas del workspace: las @menciones por email se muestran con su nombre. */
  members?: ReadonlyArray<{ email: string; name: string | null }>;
}) {
  const interactive = Boolean(onToggleTask);
  const html = useMemo(() => renderTrackMarkdown(source, { interactive }), [source, interactive]);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Completa las referencias ya resueltas que haya en el DOM. Se vuelve a
  // consultar el DOM en cada pasada: React puede reemplazar el HTML (p. ej. al
  // hidratar) y unos nodos guardados de antes quedarían sueltos.
  const upgrade = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-issue-ref]:not([data-resolved])'))) {
      const info = refCache.get(node.dataset.issueRef!)?.info;
      if (!info) continue;
      node.dataset.resolved = '1';
      node.title = `${info.identifier} ${info.title}${info.status_name ? ` · ${info.status_name}` : ''}`;
      if (node.tagName === 'A') {
        node.insertAdjacentHTML('afterbegin', statusGlyph(info));
        continue;
      }
      // ZER-12 suelto → link con glifo de estado, ID y título.
      const a = document.createElement('a');
      a.className = 'track-issue-ref is-resolved';
      a.href = `/app/track/issues/${info.id}`;
      a.dataset.issueRef = info.identifier;
      a.dataset.resolved = '1';
      a.title = node.title;
      a.innerHTML = `${statusGlyph(info)}<span class="track-issue-ref-id"></span><span class="track-issue-ref-title"></span>`;
      (a.querySelector('.track-issue-ref-id') as HTMLElement).textContent = info.identifier;
      (a.querySelector('.track-issue-ref-title') as HTMLElement).textContent = info.title;
      node.replaceWith(a);
    }
  }, []);

  // @email → @Nombre (como un chip de persona), con el email en el tooltip.
  useEffect(() => {
    if (members) rememberMembers(members);
    const root = ref.current;
    if (!root) return;
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('.track-mention[data-mention]'))) {
      const raw = node.dataset.mention!;
      const label = mentionLabel(raw);
      if (label && node.textContent !== label) {
        node.textContent = label;
        node.title = raw.slice(1);
      }
    }
  }, [html, members]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const refs = Array.from(
      new Set(Array.from(root.querySelectorAll<HTMLElement>('[data-issue-ref]')).map((n) => n.dataset.issueRef!).filter(Boolean)),
    );
    if (refs.length === 0) return;
    let alive = true;
    upgrade();
    void resolveRefs(refs).then(() => {
      if (alive) upgrade();
      // Una pasada más después del próximo render (si React tocó el HTML).
      window.setTimeout(() => alive && upgrade(), 300);
    });
    return () => {
      alive = false;
    };
  }, [html, upgrade]);

  return (
    <div
      ref={ref}
      className={`track-markdown ${className}`.trim()}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        const box = el.closest('input.track-task') as HTMLInputElement | null;
        if (box && onToggleTask) {
          e.stopPropagation();
          onToggleTask(Number(box.dataset.task));
          return;
        }
        // Links a issues: navegación de la app (sin recargar).
        const issue = el.closest('a[data-issue-ref]') as HTMLAnchorElement | null;
        if (issue && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          const url = new URL(issue.href, window.location.origin);
          router.push(url.pathname.replace(/^\/[a-z]{2}(?=\/app\/)/, ''));
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export type { MentionMember, UploadResult } from './RichEditor';
