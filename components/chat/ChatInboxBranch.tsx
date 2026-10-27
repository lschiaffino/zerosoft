'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import Icon from '@/components/app/icons';
import { useShellBranch } from '@/components/app/useShellBranch';

/** Evento: cambiaron vistas o equipos (crear, renombrar, borrar) y el sidebar se recarga. */
export const CHAT_VIEWS_CHANGED = 'zs:chat-views-changed';

export function notifyChatViewsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHAT_VIEWS_CHANGED));
}

interface Item {
  id: string;
  name: string;
  count?: number;
  open_count?: number;
}

/**
 * Debajo de "Bandeja" en el sidebar de Chat, como el panel izquierdo de
 * Intercom: Siguiendo, las bandejas de cada equipo y las vistas guardadas
 * (propias y compartidas), con su cantidad y la abierta marcada.
 */
export default function ChatInboxBranch() {
  const t = useTranslations('chat');
  const pathname = usePathname();
  const params = useSearchParams();
  const slot = useShellBranch();
  const [views, setViews] = useState<Item[] | null>(null);
  const [teams, setTeams] = useState<Item[] | null>(null);
  const inInbox = pathname === '/app/chat/inbox';
  const currentView = inInbox ? params.get('view') : null;
  const currentTeam = inInbox ? params.get('team') : null;
  const following = inInbox && params.get('following') === '1';

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/chat/views?counts=1')
        .then((r) => (r.ok ? (r.json() as Promise<{ views: Item[] }>) : null))
        .then((d) => alive && d && setViews(d.views))
        .catch(() => null);
      fetch('/api/chat/teams')
        .then((r) => (r.ok ? (r.json() as Promise<{ teams: Item[] }>) : null))
        .then((d) => alive && d && setTeams(d.teams))
        .catch(() => null);
    };
    load();
    window.addEventListener(CHAT_VIEWS_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(CHAT_VIEWS_CHANGED, load);
    };
  }, [pathname]);

  if (!slot || !views || !teams) return null;
  const row = (key: string, href: string, label: string, active: boolean, icon: 'lists' | 'groups' | 'bell', count?: number) => (
    <li key={key} className={`docs-tree-row${active ? ' active' : ''}`}>
      <span className="docs-tree-chevron-spacer" aria-hidden="true" />
      <Link href={href} className="docs-tree-link" aria-current={active ? 'page' : undefined}>
        <span className="docs-tree-icon" aria-hidden="true">
          <Icon name={icon} size={14} />
        </span>
        <span className="docs-tree-title">{label}</span>
        {typeof count === 'number' && count > 0 && <span className="chat-branch-count">{count}</span>}
      </Link>
    </li>
  );
  return createPortal(
    <nav className="docs-branch chat-inbox-branch" aria-label={t('views.sidebar')}>
      <ul className="docs-tree" role="list">
        {row('following', '/app/chat/inbox?following=1', t('views.following'), following, 'bell')}
        {teams.map((x) => row(`t-${x.id}`, `/app/chat/inbox?team=${x.id}`, x.name, currentTeam === x.id, 'groups', x.open_count))}
        {views.map((v) => row(`v-${v.id}`, `/app/chat/inbox?view=${v.id}`, v.name, currentView === v.id, 'lists', v.count))}
      </ul>
    </nav>,
    slot,
  );
}
