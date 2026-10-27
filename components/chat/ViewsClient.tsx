'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';
import EmptyState from '@/components/ui/EmptyState';
import type { ChatAgent } from '@/lib/chat-data';
import { notifyChatViewsChanged } from './ChatInboxBranch';
import ChatIcon from './icons';

interface View {
  id: string;
  name: string;
  shared: boolean;
  user_id: string;
  count?: number;
  filters: Record<string, string>;
}

/**
 * Vistas guardadas de la bandeja: se crean desde la bandeja ("Guardar
 * vista") y acá se renombran, se comparten con el equipo o se borran.
 */
export default function ViewsClient({
  me,
  agents,
  teams,
}: {
  me: string;
  agents: ChatAgent[];
  teams: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('chat');
  const [views, setViews] = useState<View[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setError(false);
    try {
      const res = await fetch('/api/chat/views?counts=1');
      if (!res.ok) throw new Error('load_failed');
      setViews(((await res.json()) as { views: View[] }).views);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/chat/views/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('save_failed');
      const updated = (await res.json()) as View;
      setViews((prev) => prev.map((v) => (v.id === id ? { ...v, ...updated } : v)));
      notifyChatViewsChanged();
      return true;
    } catch {
      setFormError(t('errors.generic'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(v: View) {
    setBusy(true);
    try {
      const res = await fetch(`/api/chat/views/${v.id}`, { method: 'DELETE' });
      if (res.ok) {
        setViews((prev) => prev.filter((x) => x.id !== v.id));
        notifyChatViewsChanged();
      }
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  }

  function describe(f: Record<string, string>): string {
    const parts: string[] = [];
    if (f.status) parts.push(t(`inbox.filters.${f.status}`));
    if (f.assignee === 'mine') parts.push(t('inbox.filters.mine'));
    else if (f.assignee === 'unassigned') parts.push(t('inbox.filters.unassigned'));
    else if (f.assignee) {
      const a = agents.find((x) => x.id === f.assignee);
      if (a) parts.push(a.name || a.email);
    }
    if (f.teamId) parts.push(teams.find((x) => x.id === f.teamId)?.name ?? t('teams.label'));
    if (f.priority) parts.push(t(`priorities.${f.priority}`));
    if (f.channel) parts.push(t(`channels.${f.channel}`));
    if (f.tag) parts.push(`#${f.tag}`);
    if (f.q) parts.push(`“${f.q}”`);
    return parts.join(' · ');
  }

  return (
    <section className="chat-pane" aria-labelledby="chat-views-title">
      <div className="chat-pane-head">
        {/* El título y la descripción van en el encabezado de la página. */}
        <h2 id="chat-views-title" className="sr-only">
          {t('views.title')}
        </h2>
        <Link href="/app/chat/inbox" className="btn btn-secondary btn-sm">
          {t('views.create')}
        </Link>
      </div>
      {error ? (
        <div className="chat-load-error" role="alert">
          <p>{t('errors.loadFailed')}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      ) : !loaded ? (
        <div className="ui-loading-stack" aria-label={t('common.loading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : views.length === 0 ? (
        <EmptyState
          title={t('views.empty')}
          body={t('views.emptySub')}
          action={
            <Link href="/app/chat/inbox" className="btn btn-primary">
              {t('views.create')}
            </Link>
          }
          product="chat"
        />
      ) : (
        <div className="table-wrap chat-stack">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('views.name')}</th>
                <th scope="col">{t('views.filters')}</th>
                <th scope="col" className="num">
                  {t('reports.conversations')}
                </th>
                <th scope="col">{t('views.sharing')}</th>
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {views.map((v) => {
                const own = v.user_id === me;
                return (
                  <tr key={v.id}>
                    <td>
                      <Link href={`/app/chat/inbox?view=${v.id}`} className="chat-row-button">
                        {v.name}
                      </Link>
                    </td>
                    <td data-label={t('views.filters')}>{describe(v.filters) || <span className="chat-quiet">{t('views.noFilters')}</span>}</td>
                    <td className="num data" data-label={t('reports.conversations')}>
                      {v.count ?? 0}
                    </td>
                    <td data-label={t('views.sharing')}>
                      {own ? (
                        <label className="ui-switch">
                          <input
                            type="checkbox"
                            role="switch"
                            checked={v.shared}
                            onChange={(e) => void patch(v.id, { shared: e.target.checked })}
                            aria-label={t('views.shareNamed', { name: v.name })}
                          />
                          <span aria-hidden="true">{v.shared ? t('views.shared') : t('views.private')}</span>
                        </label>
                      ) : (
                        <span className="chat-quiet">{t('views.sharedWithYou')}</span>
                      )}
                    </td>
                    <td className="chat-row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setFormError(null);
                          setRenaming({ id: v.id, name: v.name });
                        }}
                        aria-label={t('views.renameNamed', { name: v.name })}
                      >
                        {t('views.rename')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => setConfirmDelete(v)}
                        aria-label={t('views.deleteNamed', { name: v.name })}
                        title={t('common.delete')}
                      >
                        <ChatIcon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <QuickModal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={t('views.rename')}
        onSubmit={async () => {
          if (renaming && renaming.name.trim() && (await patch(renaming.id, { name: renaming.name.trim() }))) setRenaming(null);
        }}
        submitLabel={t('common.save')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!renaming?.name.trim()}
        busy={busy}
        error={formError}
      >
        <div className="ui-field">
          <label className="label" htmlFor="view-name">
            {t('views.name')}
          </label>
          <input
            id="view-name"
            className="input"
            data-autofocus
            maxLength={80}
            value={renaming?.name ?? ''}
            onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
          />
        </div>
      </QuickModal>

      <QuickModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t('views.deleteTitle')}
        onSubmit={() => confirmDelete && void remove(confirmDelete)}
        submitLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        centered
      >
        <p>{t('views.deleteBody', { name: confirmDelete?.name ?? '' })}</p>
      </QuickModal>
    </section>
  );
}
