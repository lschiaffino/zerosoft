'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import EmptyState from '@/components/ui/EmptyState';
import type { ChatAgent } from '@/lib/chat-data';
import { notifyChatViewsChanged } from './ChatInboxBranch';
import ChatIcon from './icons';

interface Team {
  id: string;
  name: string;
  member_ids: string[];
  open_count: number;
}

interface Form {
  name: string;
  members: string[];
}

/**
 * Equipos de Chat (como los de Intercom): nombre y miembros. Cada equipo
 * tiene su bandeja en el sidebar y las reglas pueden asignarle
 * conversaciones (y repartirlas entre sus miembros). Crear, editar y borrar
 * es de admins; todos los ven.
 */
export default function TeamsClient({ agents, canManage }: { agents: ChatAgent[]; canManage: boolean }) {
  const t = useTranslations('chat');
  const params = useSearchParams();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({ name: '', members: [] });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Team | null>(null);

  async function load() {
    setError(false);
    try {
      const res = await fetch('/api/chat/teams');
      if (!res.ok) throw new Error('load_failed');
      setTeams(((await res.json()) as { teams: Team[] }).teams);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // ?open=<id> (desde ⌘K o un link) abre el equipo.
  useEffect(() => {
    const id = params.get('open');
    const team = id ? teams.find((x) => x.id === id) : null;
    if (team && canManage) startEdit(team);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, teams.length]);

  useKeyShortcut('c', () => startCreate(), canManage && editing === null);

  function startCreate() {
    setFormError(null);
    setEditing('new');
    setForm({ name: '', members: [] });
  }

  function startEdit(team: Team) {
    setFormError(null);
    setEditing(team.id);
    setForm({ name: team.name, members: team.member_ids });
  }

  async function save() {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const isNew = editing === 'new';
      const res = await fetch(isNew ? '/api/chat/teams' : `/api/chat/teams/${editing}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), memberIds: form.members }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(data.error === 'forbidden' ? t('teams.adminOnly') : t('errors.generic'));
        return;
      }
      setEditing(null);
      await load();
      notifyChatViewsChanged();
    } catch {
      setFormError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(team: Team) {
    setBusy(true);
    try {
      const res = await fetch(`/api/chat/teams/${team.id}`, { method: 'DELETE' });
      if (res.ok) {
        setTeams((prev) => prev.filter((x) => x.id !== team.id));
        notifyChatViewsChanged();
      }
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  }

  const agentName = (id: string) => {
    const a = agents.find((x) => x.id === id);
    return a ? a.name || a.email : null;
  };

  const createButton = canManage ? (
    <button type="button" className="btn btn-primary" onClick={startCreate} aria-keyshortcuts="c">
      {t('teams.add')}
    </button>
  ) : undefined;

  return (
    <section className="chat-pane" aria-labelledby="chat-teams-title">
      <div className="chat-pane-head">
        {/* El título y la descripción van en el encabezado de la página. */}
        <h2 id="chat-teams-title" className="sr-only">
          {t('teams.title')}
        </h2>
        {teams.length > 0 && canManage && (
          <button type="button" className="btn btn-primary btn-sm" onClick={startCreate} aria-keyshortcuts="c">
            {t('teams.add')}
            <kbd className="kbd">C</kbd>
          </button>
        )}
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
      ) : teams.length === 0 ? (
        <EmptyState title={t('teams.empty')} body={canManage ? t('teams.emptySub') : t('teams.adminOnly')} action={createButton} product="chat" />
      ) : (
        <div className="table-wrap chat-stack">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('teams.name')}</th>
                <th scope="col">{t('teams.members')}</th>
                <th scope="col" className="num">
                  {t('teams.open')}
                </th>
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <Link href={`/app/chat/inbox?team=${team.id}`} className="chat-row-button">
                      {team.name}
                    </Link>
                  </td>
                  <td data-label={t('teams.members')}>
                    {team.member_ids.length === 0 ? (
                      <span className="chat-quiet">{t('teams.noMembers')}</span>
                    ) : (
                      team.member_ids.map(agentName).filter(Boolean).join(', ')
                    )}
                  </td>
                  <td className="num data" data-label={t('teams.open')}>
                    {team.open_count}
                  </td>
                  <td className="chat-row-actions">
                    {canManage && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(team)} aria-label={t('teams.editNamed', { name: team.name })}>
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => setConfirmDelete(team)}
                          aria-label={t('teams.deleteNamed', { name: team.name })}
                          title={t('common.delete')}
                        >
                          <ChatIcon name="trash" size={14} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('teams.newTitle') : t('teams.editTitle')}
        onSubmit={() => void save()}
        submitLabel={editing === 'new' ? t('teams.create') : t('common.save')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!form.name.trim()}
        busy={busy}
        error={formError}
      >
        <div className="ui-fields">
          <div className="ui-field">
            <label className="label" htmlFor="team-name">
              {t('teams.name')}
            </label>
            <input
              id="team-name"
              className="input"
              data-autofocus
              maxLength={80}
              value={form.name}
              placeholder={t('teams.namePlaceholder')}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <fieldset className="ui-field chat-team-members">
            <legend className="label">{t('teams.members')}</legend>
            {agents.map((a) => (
              <label key={a.id} className="ui-check">
                <input
                  type="checkbox"
                  checked={form.members.includes(a.id)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      members: e.target.checked ? [...f.members, a.id] : f.members.filter((x) => x !== a.id),
                    }))
                  }
                />
                {a.name || a.email}
              </label>
            ))}
          </fieldset>
        </div>
      </QuickModal>

      <QuickModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t('teams.deleteTitle')}
        onSubmit={() => confirmDelete && void remove(confirmDelete)}
        submitLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        centered
      >
        <p>{t('teams.deleteBody', { name: confirmDelete?.name ?? '' })}</p>
      </QuickModal>
    </section>
  );
}
