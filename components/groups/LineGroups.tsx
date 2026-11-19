'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { GroupsPerson, NumberDto } from '@/lib/groups';
import type { LineGroupDto, PersonLineAccess } from '@/lib/groups-line-groups';
import PersonPicker from './PersonPicker';
import LineDot from './LineDot';
import { Modal, api, useErrorText } from './ui';

type Team = { id: string; name: string };
type Line = Pick<NumberDto, 'id' | 'name' | 'phone' | 'color' | 'visibility' | 'ownerId' | 'groupId'>;

const lineLabel = (n: Pick<NumberDto, 'name' | 'phone'>) => n.name || (n.phone ? `+${n.phone}` : '');
const toggled = (set: Set<string>, id: string) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/**
 * Ajustes › Números, para admins: los grupos de líneas (crear, renombrar,
 * ordenar, borrar, qué líneas tiene cada uno y a quién se le da) y, debajo,
 * el acceso mirado desde una persona: qué grupos y qué líneas tiene.
 */
export default function LineGroups({
  groups,
  numbers,
  people,
  teams,
  onChanged,
  notify,
}: {
  groups: LineGroupDto[];
  numbers: Line[];
  people: GroupsPerson[];
  teams: Team[];
  /** Cambió algo (grupos, líneas de un grupo, accesos o visibilidad): la pantalla vuelve a pedir líneas y grupos. */
  onChanged: (groups?: LineGroupDto[]) => void;
  notify: (text: string, isError?: boolean) => void;
}) {
  const t = useTranslations('groups.lineGroups');
  const tc = useTranslations('groups.common');
  const errText = useErrorText();
  const [editing, setEditing] = useState<LineGroupDto | 'new' | null>(null);
  const [removing, setRemoving] = useState<LineGroupDto | null>(null);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name || p.email])), [people]);
  const teamNames = useMemo(() => new Map(teams.map((tm) => [tm.id, tm.name])), [teams]);

  async function move(g: LineGroupDto, dir: -1 | 1) {
    const order = groups.map((x) => x.id);
    const i = order.indexOf(g.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const res = await api<{ groups: LineGroupDto[] }>('/api/groups/line-groups', { method: 'PATCH', body: { order } });
    if (!res.data) return notify(errText(res.error), true);
    onChanged(res.data.groups);
  }

  async function remove() {
    const g = removing;
    setRemoving(null);
    if (!g) return;
    const res = await api(`/api/groups/line-groups?id=${encodeURIComponent(g.id)}`, { method: 'DELETE' });
    if (!res.data) return notify(errText(res.error), true);
    notify(t('deleted', { name: g.name }));
    onChanged();
  }

  return (
    <section className="gr-lgroups" aria-labelledby="gr-lgroups-title" data-testid="line-groups">
      <div className="gr-lgroups-head">
        <div>
          <h2 className="gr-lgroups-title" id="gr-lgroups-title">
            {t('title')}
          </h2>
          <p className="ui-help">{t('intro')}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing('new')} data-testid="line-group-new">
          {t('new')}
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="ui-help" data-testid="line-groups-empty">
          {t('empty')}
        </p>
      ) : (
        <ul className="gr-lgroups-list">
          {groups.map((g, i) => {
            const lines = numbers.filter((n) => n.groupId === g.id);
            const open = lines.filter((n) => n.visibility === 'all');
            const who = [...(g.access?.personIds ?? []).map((id) => names.get(id)), ...(g.access?.teamIds ?? []).map((id) => teamNames.get(id))].filter(Boolean) as string[];
            return (
              <li key={g.id} className="gr-lgroup" data-testid="line-group" data-group-id={g.id}>
                <div className="gr-lgroup-main">
                  <strong className="gr-lgroup-name">{g.name}</strong>
                  <span className="ui-help">
                    {t('linesCount', { n: lines.length })}
                    {lines.length > 0 ? `: ${lines.map(lineLabel).join(', ')}` : ''}
                  </span>
                  <span className="ui-help" data-testid="line-group-who">
                    {who.length ? t('givenTo', { who: who.join(', ') }) : t('givenToNobody')}
                  </span>
                  {open.length > 0 && (
                    <span className="ui-help gr-lgroup-warn" data-testid="line-group-open-warning">
                      {t('openWarning', { n: open.length })}
                    </span>
                  )}
                </div>
                <div className="gr-lgroup-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(g)} data-testid="line-group-edit">
                    {t('edit')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => void move(g, -1)} aria-label={t('moveUp', { name: g.name })} title={t('moveUp', { name: g.name })}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={i === groups.length - 1}
                    onClick={() => void move(g, 1)}
                    aria-label={t('moveDown', { name: g.name })}
                    title={t('moveDown', { name: g.name })}
                  >
                    ↓
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(g)} data-testid="line-group-delete">
                    {tc('delete')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <PersonAccess groups={groups} numbers={numbers} people={people} onChanged={onChanged} notify={notify} />
      <GroupForm
        editing={editing}
        groups={groups}
        numbers={numbers}
        people={people}
        teams={teams}
        onClose={() => setEditing(null)}
        onSaved={(name) => {
          setEditing(null);
          notify(t('saved', { name }));
          onChanged();
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={t('deleteTitle', { name: removing?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}

/** Crear o editar un grupo: nombre, líneas y a quién se le da. */
function GroupForm({
  editing,
  groups,
  numbers,
  people,
  teams,
  onClose,
  onSaved,
}: {
  editing: LineGroupDto | 'new' | null;
  groups: LineGroupDto[];
  numbers: Line[];
  people: GroupsPerson[];
  teams: Team[];
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useTranslations('groups.lineGroups');
  const tc = useTranslations('groups.common');
  const errText = useErrorText();
  const [name, setName] = useState('');
  const [lineIds, setLineIds] = useState<Set<string>>(new Set());
  const [personIds, setPersonIds] = useState<Set<string>>(new Set());
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [restrict, setRestrict] = useState(true);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const group = editing && editing !== 'new' ? editing : null;

  useEffect(() => {
    if (!editing) return;
    const g = editing === 'new' ? null : editing;
    setName(g?.name ?? '');
    setLineIds(new Set(g ? numbers.filter((n) => n.groupId === g.id).map((n) => n.id) : []));
    setPersonIds(new Set(g?.access?.personIds ?? []));
    setTeamIds(new Set(g?.access?.teamIds ?? []));
    setRestrict(true);
    setFilter('');
    setError('');
    // Solo al abrir: mientras el diálogo está abierto, la lista de líneas puede refrescarse sola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const groupNames = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const openPicked = numbers.filter((n) => lineIds.has(n.id) && n.visibility === 'all');
  const q = filter.trim().toLowerCase();
  const shownPeople = q ? people.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || personIds.has(p.id)) : people;

  async function submit() {
    if (!editing) return;
    setBusy(true);
    setError('');
    let id = group?.id ?? '';
    if (!id) {
      const made = await api<LineGroupDto>('/api/groups/line-groups', { body: { name } });
      if (!made.data) {
        setBusy(false);
        return setError(errText(made.error));
      }
      id = made.data.id;
    }
    const res = await api('/api/groups/line-groups', {
      method: 'PATCH',
      body: { id, ...(group ? { name } : {}), numberIds: [...lineIds], personIds: [...personIds], teamIds: [...teamIds] },
    });
    if (!res.data) {
      setBusy(false);
      return setError(errText(res.error));
    }
    // Líneas del grupo que todavía ve todo el workspace: se restringen para que el acceso del grupo valga.
    if (restrict) {
      for (const n of openPicked) {
        const r = await api(`/api/groups/numbers/${n.id}`, { method: 'PATCH', body: { visibility: 'restricted' } });
        if (!r.data) {
          setBusy(false);
          return setError(errText(r.error));
        }
      }
    }
    setBusy(false);
    onSaved(name.trim());
  }

  return (
    <Modal
      open={!!editing}
      title={group ? t('editTitle', { name: group.name }) : t('newTitle')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {tc('cancel')}
          </button>
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined} data-testid="line-group-save">
            {tc('save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <label className="ui-field">
          <span className="label">{t('name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder={t('namePlaceholder')} data-testid="line-group-name" />
        </label>
        <fieldset className="ui-field">
          <legend className="label">{t('lines')}</legend>
          {numbers.length === 0 && <span className="ui-help">{t('noLines')}</span>}
          {numbers.map((n) => {
            const other = n.groupId && n.groupId !== group?.id ? groupNames.get(n.groupId) : '';
            return (
              <label key={n.id} className="gr-check-label" data-testid="line-group-line" data-number-id={n.id}>
                <input type="checkbox" className="ui-check" checked={lineIds.has(n.id)} onChange={() => setLineIds((s) => toggled(s, n.id))} />
                <LineDot color={n.color} />
                <span>{lineLabel(n)}</span>
                {other && !lineIds.has(n.id) && <span className="ui-help">{t('inGroup', { name: other })}</span>}
                {other && lineIds.has(n.id) && <span className="ui-help">{t('movesFrom', { name: other })}</span>}
              </label>
            );
          })}
          <span className="ui-help">{t('linesHelp')}</span>
        </fieldset>
        <fieldset className="ui-field">
          <legend className="label">{t('people')}</legend>
          {people.length > 8 && (
            <input type="search" className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('peopleFilter')} aria-label={t('peopleFilter')} />
          )}
          <div className="gr-lgroup-checks">
            {shownPeople.map((p) => (
              <label key={p.id} className="gr-check-label" data-testid="line-group-person" data-person-id={p.id}>
                <input type="checkbox" className="ui-check" checked={personIds.has(p.id)} onChange={() => setPersonIds((s) => toggled(s, p.id))} />
                {p.name || p.email}
              </label>
            ))}
          </div>
          <span className="ui-help">{t('peopleHelp')}</span>
        </fieldset>
        {teams.length > 0 && (
          <fieldset className="ui-field">
            <legend className="label">{t('teams')}</legend>
            {teams.map((tm) => (
              <label key={tm.id} className="gr-check-label">
                <input type="checkbox" className="ui-check" checked={teamIds.has(tm.id)} onChange={() => setTeamIds((s) => toggled(s, tm.id))} />
                {tm.name}
              </label>
            ))}
          </fieldset>
        )}
        {openPicked.length > 0 && (
          <div className="gr-lgroup-open" data-testid="line-group-restrict">
            <label className="gr-check-label">
              <input type="checkbox" className="ui-check" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} />
              {t('restrict', { n: openPicked.length })}
            </label>
            <span className="ui-help">{t('restrictHelp', { lines: openPicked.map(lineLabel).join(', ') })}</span>
          </div>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** El acceso mirado desde una persona: qué grupos y qué líneas tiene dados a su nombre. */
function PersonAccess({
  groups,
  numbers,
  people,
  onChanged,
  notify,
}: {
  groups: LineGroupDto[];
  numbers: Line[];
  people: GroupsPerson[];
  onChanged: (groups?: LineGroupDto[]) => void;
  notify: (text: string, isError?: boolean) => void;
}) {
  const t = useTranslations('groups.lineGroups');
  const tc = useTranslations('groups.common');
  const errText = useErrorText();
  const [personId, setPersonId] = useState('');
  const [loaded, setLoaded] = useState<PersonLineAccess | null>(null);
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set());
  const [lineIds, setLineIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoaded(null);
    if (!personId) return;
    let stale = false;
    void api<{ person: PersonLineAccess }>(`/api/groups/line-groups?person=${encodeURIComponent(personId)}`).then((res) => {
      if (stale) return;
      if (!res.data) return notify(errText(res.error), true);
      setLoaded(res.data.person);
      setGroupIds(new Set(res.data.person.groupIds));
      setLineIds(new Set(res.data.person.numberIds));
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  async function save() {
    setBusy(true);
    const res = await api<{ groups: LineGroupDto[]; person: PersonLineAccess }>('/api/groups/line-groups', {
      method: 'PATCH',
      body: { personId, groupIds: [...groupIds], numberIds: [...lineIds] },
    });
    setBusy(false);
    if (!res.data) return notify(errText(res.error), true);
    setLoaded(res.data.person);
    const p = people.find((x) => x.id === personId);
    notify(t('personSaved', { name: p ? p.name || p.email : '' }));
    onChanged(res.data.groups);
  }

  /** Por qué ve la línea sin que se la den una por una ('' = no la ve por otra vía). */
  const why = (n: Line): string => {
    if (!loaded) return '';
    if (n.visibility === 'all') return t('whyEveryone');
    if (n.ownerId === personId) return t('whyOwner');
    if (n.groupId && groupIds.has(n.groupId)) return t('whyGroup');
    if (loaded.teamNumberIds.includes(n.id) || (n.groupId && loaded.teamGroupIds.includes(n.groupId))) return t('whyTeam');
    return '';
  };
  const lineRow = (n: Line) => {
    const reason = why(n);
    return (
      <label key={n.id} className="gr-check-label gr-paccess-line" data-testid="person-access-line" data-number-id={n.id}>
        <input type="checkbox" className="ui-check" checked={Boolean(reason) || lineIds.has(n.id)} disabled={Boolean(reason)} onChange={() => setLineIds((s) => toggled(s, n.id))} />
        <LineDot color={n.color} />
        <span>{lineLabel(n)}</span>
        {reason && <span className="ui-help">{reason}</span>}
      </label>
    );
  };
  const loose = numbers.filter((n) => !n.groupId || !groups.some((g) => g.id === n.groupId));

  return (
    <div className="gr-paccess" data-testid="person-access">
      <div className="gr-paccess-head">
        <h3 className="gr-lgroups-subtitle">{t('personTitle')}</h3>
        <PersonPicker
          testId="person-access-pick"
          label={t('personPick')}
          value={personId}
          people={people}
          onChange={setPersonId}
          noneLabel={t('personNone')}
          searchLabel={t('personSearch')}
          emptyLabel={t('personNoMatch')}
        />
      </div>
      {!personId && <p className="ui-help">{t('personHelp')}</p>}
      {personId && loaded && (
        <div className="gr-paccess-body">
          {groups.map((g) => (
            <div key={g.id} className="gr-paccess-group" data-testid="person-access-group" data-group-id={g.id}>
              <label className="gr-check-label gr-paccess-group-name">
                <input type="checkbox" className="ui-check" checked={groupIds.has(g.id)} onChange={() => setGroupIds((s) => toggled(s, g.id))} />
                <strong>{g.name}</strong>
                <span className="ui-help">{loaded.teamGroupIds.includes(g.id) && !groupIds.has(g.id) ? t('whyTeam') : t('wholeGroup')}</span>
              </label>
              {numbers.filter((n) => n.groupId === g.id).map(lineRow)}
            </div>
          ))}
          {loose.length > 0 && (
            <div className="gr-paccess-group">
              {groups.length > 0 && <span className="label">{t('ungrouped')}</span>}
              {loose.map(lineRow)}
            </div>
          )}
          <div className="gr-paccess-foot">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} aria-busy={busy || undefined} disabled={busy} data-testid="person-access-save">
              {tc('save')}
            </button>
            <span className="ui-help">{t('personFoot')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
