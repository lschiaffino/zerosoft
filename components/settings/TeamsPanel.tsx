'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import QuickModal from '@/components/app/QuickModal';
import type { GroupDto, MemberDto } from '@/lib/workspace-directory';

interface Person {
  userId: string;
  name: string | null;
  email: string;
}

function PeoplePicker({
  people,
  value,
  leads,
  onChange,
  onLeads,
  idPrefix,
}: {
  people: Person[];
  value: string[];
  leads?: string[];
  onChange: (v: string[]) => void;
  onLeads?: (v: string[]) => void;
  idPrefix: string;
}) {
  const t = useTranslations('settings.teamsForm');
  return (
    <fieldset className="st-fieldset">
      <legend className="label">{t('members')}</legend>
      <div className="ws-people-list">
        {people.map((p) => {
          const on = value.includes(p.userId);
          return (
            <div key={p.userId} className="ws-people-row">
              <label className="ui-check" htmlFor={`${idPrefix}-${p.userId}`}>
                <input
                  id={`${idPrefix}-${p.userId}`}
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onChange(e.target.checked ? [...value, p.userId] : value.filter((x) => x !== p.userId))}
                />
                <span>
                  {p.name || p.email.split('@')[0]} <span className="data st-muted">{p.email}</span>
                </span>
              </label>
              {onLeads && on && (
                <label className="ui-check ws-lead">
                  <input
                    type="checkbox"
                    checked={(leads ?? []).includes(p.userId)}
                    onChange={(e) => onLeads(e.target.checked ? [...(leads ?? []), p.userId] : (leads ?? []).filter((x) => x !== p.userId))}
                  />
                  <span>{t('lead')}</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Ajustes › Equipos: subequipos del workspace (Ventas, Soporte…). Un solo
 * directorio: el CRM los usa para visibilidad y round-robin, Chat para el
 * inbox por equipo, Groups para asignar y Talk para @menciones.
 */
export default function TeamsPanel({
  initial,
  people,
  canEdit,
}: {
  initial: GroupDto[];
  people: MemberDto[];
  canEdit: boolean;
}) {
  const t = useTranslations('settings.teamsForm');
  const [groups, setGroups] = useState<GroupDto[]>(initial);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<GroupDto | null>(null);
  const [edit, setEdit] = useState<{ name: string; description: string; memberIds: string[]; leadIds: string[] }>({
    name: '',
    description: '',
    memberIds: [],
    leadIds: [],
  });
  const [deleting, setDeleting] = useState<GroupDto | null>(null);
  const roster = people.filter((p) => p.role !== 'guest');
  const nameOf = (id: string) => {
    const p = roster.find((x) => x.userId === id);
    return p ? p.name || p.email.split('@')[0] : null;
  };

  async function refresh() {
    const res = await fetch('/api/teams/members').catch(() => null);
    if (res?.ok) setGroups(((await res.json()) as { groups: GroupDto[] }).groups);
  }

  async function call(input: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(input, { ...init, headers: { 'content-type': 'application/json' } }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const code = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
      setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.save'));
      return false;
    }
    return true;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    if (await call('/api/teams/groups', { method: 'POST', body: JSON.stringify({ name: name.trim(), memberIds: members }) })) {
      setName('');
      setMembers([]);
      await refresh();
    }
  }

  function openEdit(g: GroupDto) {
    setEditing(g);
    setEdit({ name: g.name, description: g.description, memberIds: g.memberIds, leadIds: g.leadIds });
  }

  async function saveEdit() {
    if (!editing || !edit.name.trim()) return;
    if (await call(`/api/teams/groups/${encodeURIComponent(editing.id)}`, { method: 'PATCH', body: JSON.stringify(edit) })) {
      setEditing(null);
      await refresh();
    }
  }

  async function remove() {
    if (!deleting) return;
    const ok = await call(`/api/teams/groups/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
    setDeleting(null);
    if (ok) await refresh();
  }

  return (
    <>
      {canEdit && (
        <FormSection title={t('createTitle')} description={t('createDesc')}>
          <form className="ws-invite" onSubmit={onCreate}>
            <div className="ui-field">
              <label className="label" htmlFor="ws-group-name">
                {t('name')}
              </label>
              <input
                id="ws-group-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                maxLength={60}
                autoComplete="off"
              />
            </div>
            {roster.length > 1 && <PeoplePicker people={roster} value={members} onChange={setMembers} idPrefix="ws-new-grp" />}
            <div className="st-form-foot">
              <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy} aria-busy={busy || undefined}>
                {t('create')}
              </button>
            </div>
          </form>
        </FormSection>
      )}

      <FormSection title={t('listTitle', { count: groups.length })} description={t('listDesc')}>
        {error && !editing && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {groups.length === 0 ? (
          <EmptyState quiet title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="ws-groups" aria-label={t('listTitle', { count: groups.length })}>
            {groups.map((g) => (
              <li key={g.id} className="ws-group" data-testid="group-row">
                <div className="ws-group-main">
                  <p className="ws-group-name">
                    <span className="st-strong">{g.name}</span> <span className="data st-muted">@{g.slug}</span>
                  </p>
                  {g.description && <p className="ui-help">{g.description}</p>}
                  <p className="ws-cell-muted">
                    {g.memberIds.length
                      ? t('membersList', {
                          count: g.memberIds.length,
                          names: g.memberIds
                            .map((id) => {
                              const n = nameOf(id);
                              return n && g.leadIds.includes(id) ? `${n} (${t('lead').toLowerCase()})` : n;
                            })
                            .filter(Boolean)
                            .join(', '),
                        })
                      : t('noMembers')}
                  </p>
                </div>
                {canEdit && (
                  <div className="st-row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(g)} disabled={busy}>
                      {t('edit')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger btn-sm"
                      onClick={() => setDeleting(g)}
                      disabled={busy}
                      aria-label={t('deleteOf', { name: g.name })}
                    >
                      {t('delete')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="ui-help ws-groups-uses">{t('uses')}</p>
      </FormSection>

      <QuickModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('editTitle')}
        onSubmit={() => void saveEdit()}
        submitLabel={t('save')}
        cancelLabel={t('cancel')}
        submitDisabled={!edit.name.trim()}
        busy={busy}
        error={editing ? error : null}
        width={560}
      >
        <div className="ui-field">
          <label className="label" htmlFor="ws-edit-group-name">
            {t('name')}
          </label>
          <input
            id="ws-edit-group-name"
            className="input"
            value={edit.name}
            onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))}
            maxLength={60}
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="ws-edit-group-desc">
            {t('description')}
          </label>
          <input
            id="ws-edit-group-desc"
            className="input"
            value={edit.description}
            onChange={(e) => setEdit((p) => ({ ...p, description: e.target.value }))}
            maxLength={280}
          />
        </div>
        <PeoplePicker
          people={roster}
          value={edit.memberIds}
          leads={edit.leadIds}
          onChange={(memberIds) => setEdit((p) => ({ ...p, memberIds, leadIds: p.leadIds.filter((l) => memberIds.includes(l)) }))}
          onLeads={(leadIds) => setEdit((p) => ({ ...p, leadIds }))}
          idPrefix="ws-edit-grp"
        />
      </QuickModal>

      <ConfirmDialog
        open={deleting !== null}
        danger
        busy={busy}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
