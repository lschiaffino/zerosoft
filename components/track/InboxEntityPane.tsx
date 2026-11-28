'use client';

import { useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { inboxListHref } from '@/lib/track-inbox-panel';
import TrackIcon from './TrackIcon';
import { isTypingTarget } from './trackCommands';

/**
 * Un project o una iniciativa abiertos desde un aviso, en el panel de la
 * bandeja (como un issue): arriba, el link a su página y la cruz; Esc cierra
 * el panel y la bandeja queda donde estaba.
 */
export default function InboxEntityPane({ kind, id, children }: { kind: 'project' | 'initiative'; id: string; children: ReactNode }) {
  const ti = useTranslations('track.inbox.panel');
  const router = useRouter();
  const close = () => router.replace(inboxListHref(window.location.search), { scroll: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], dialog[open], .cmdk, [role="menu"], [role="listbox"]')) return;
      e.preventDefault();
      router.replace(inboxListHref(window.location.search), { scroll: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  const page = kind === 'project' ? `/app/track/projects/${id}` : `/app/track/initiatives/${id}`;
  return (
    <div className="track-inbox-entity" data-testid="track-inbox-entity" data-kind={kind}>
      <div className="track-inbox-entity-bar">
        <Link href={page} className="btn btn-ghost btn-sm track-inbox-entity-open" data-testid="track-inbox-entity-open">
          {kind === 'project' ? ti('openProject') : ti('openInitiative')}
        </Link>
        <button
          type="button"
          className="btn btn-ghost btn-icon track-head-icon track-panel-close"
          onClick={close}
          aria-label={ti('close')}
          title={`${ti('close')} · Esc`}
          aria-keyshortcuts="Escape"
          data-testid="track-inbox-panel-close"
        >
          <TrackIcon name="close" size={14} />
        </button>
      </div>
      {children}
    </div>
  );
}
