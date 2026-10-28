'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { TalkChannelDto } from '@/lib/talk';
import type { ListCommentDto, ListDto, ListField, ListFieldType, ListItemDto, ListView } from '@/lib/talk-lists';
import { errorText } from './Composer';
import { Modal } from './Dialogs';
import { fmtFull } from './Message';
import { Avatar } from './MessageBody';
import { useTalk } from './talk-context';

type Value = string | number | boolean | null;
const VIEW_KEY = 'talk.listView';
const FIELD_TYPES: ListFieldType[] = ['text', 'number', 'select', 'person', 'date', 'checkbox'];

function readView(listId: string): string | null {
  try {
    return localStorage.getItem(`${VIEW_KEY}.${listId}`);
  } catch {
    return null;
  }
}
function writeView(listId: string, viewId: string) {
  try {
    localStorage.setItem(`${VIEW_KEY}.${listId}`, viewId);
  } catch {
    /* sin storage */
  }
}

function display(v: Value, f: ListField, personName: (id: string) => string): string {
  if (v === null || v === undefined || v === '') return '';
  if (f.type === 'checkbox') return v ? '✓' : '';
  if (f.type === 'person') return personName(String(v));
  return String(v);
}

/** Editor de un valor según el tipo de campo (en la tabla, el tablero y el panel del ítem). */
function FieldInput({ field, value, members, disabled, onChange, label }: { field: ListField; value: Value; members: string[]; disabled: boolean; onChange: (v: Value) => void; label: string }) {
  const t = useTranslations('talk');
  const { personName } = useTalk();
  if (field.type === 'checkbox')
    return <input type="checkbox" aria-label={label} checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
  if (field.type === 'select' || field.type === 'person') {
    const options = field.type === 'select' ? (field.options ?? []).map((o) => ({ v: o, l: o })) : members.map((m) => ({ v: m, l: personName(m) }));
    return (
      <select className="select talk-list-cell-input" aria-label={label} value={value === null || value === undefined ? '' : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('lists.none')}</option>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="input talk-list-cell-input"
      aria-label={label}
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      defaultValue={value === null || value === undefined ? '' : String(value)}
      disabled={disabled}
      onBlur={(e) => {
        const raw = e.target.value;
        const next = raw === '' ? null : field.type === 'number' ? Number(raw) : raw;
        if (String(next ?? '') !== String(value ?? '')) onChange(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          (e.target as HTMLInputElement).value = value === null || value === undefined ? '' : String(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export default function ListsPane({ channel, initialListId }: { channel: TalkChannelDto; initialListId: string | null }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { api, toast, subscribe } = ctx;
  const [lists, setLists] = useState<ListDto[] | null>(null);
  const [error, setError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(initialListId);
  const [creating, setCreating] = useState(false);

  const loadLists = useCallback(async () => {
    try {
      const res = await api<{ lists: ListDto[] }>(`/api/talk/lists?channelId=${encodeURIComponent(channel.id)}`);
      setLists(res.lists);
      setError(false);
      setActiveId((cur) => (cur && res.lists.some((l) => l.id === cur) ? cur : (res.lists[0]?.id ?? null)));
    } catch {
      setError(true);
    }
  }, [api, channel.id]);

  useEffect(() => {
    setLists(null);
    void loadLists();
  }, [loadLists]);

  // Otra persona creó, renombró o borró una lista.
  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () =>
      subscribe((ev) => {
        if (ev.type !== 'events') return;
        if (!ev.events.some((e) => e.kind === 'list' && e.channelId === channel.id && ['created', 'deleted', 'updated'].includes(String((e.payload as { change?: string }).change)))) return;
        if (listTimer.current) clearTimeout(listTimer.current);
        listTimer.current = setTimeout(() => void loadLists(), 250);
      }),
    [subscribe, channel.id, loadLists],
  );

  const canWrite = channel.isMember && !channel.archived;
  const active = lists?.find((l) => l.id === activeId) ?? null;

  if (error)
    return (
      <div className="talk-error" role="alert">
        <p>{t('lists.loadError')}</p>
        <button type="button" className="btn btn-sm" onClick={() => void loadLists()}>
          {t('common.retry')}
        </button>
      </div>
    );
  if (!lists)
    return (
      <div className="ui-loading-stack talk-loading" aria-busy="true" aria-label={t('common.loading')}>
        <div className="ui-skeleton ui-skeleton-row" />
        <div className="ui-skeleton ui-skeleton-row" />
      </div>
    );

  return (
    <div className="talk-lists" data-testid="talk-lists">
      <div className="talk-lists-bar">
        <ul className="talk-lists-tabs" aria-label={t('lists.title')}>
          {lists.map((l) => (
            <li key={l.id}>
              <button type="button" className="talk-tab" aria-current={l.id === activeId ? 'true' : undefined} onClick={() => setActiveId(l.id)}>
                {l.name} <span className="talk-muted">{l.itemCount}</span>
              </button>
            </li>
          ))}
        </ul>
        {canWrite && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(true)} data-testid="talk-list-new">
            {t('lists.new')}
          </button>
        )}
      </div>
      {lists.length === 0 ? (
        <div className="ui-empty talk-empty">
          <p className="ui-empty-title">{t('lists.emptyTitle')}</p>
          <p className="ui-empty-body">{t('lists.emptyBody')}</p>
          {canWrite && (
            <div className="ui-empty-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                {t('lists.new')}
              </button>
            </div>
          )}
        </div>
      ) : active ? (
        <ListBody key={active.id} list={active} channel={channel} onChanged={() => void loadLists()} onDeleted={() => void loadLists()} />
      ) : null}
      {creating && (
        <NewList
          channelId={channel.id}
          onClose={() => setCreating(false)}
          onCreated={(l) => {
            setCreating(false);
            setLists((prev) => [...(prev ?? []), l]);
            setActiveId(l.id);
            toast(t('lists.created'));
          }}
        />
      )}
    </div>
  );
}

function NewList({ channelId, onClose, onCreated }: { channelId: string; onClose: () => void; onCreated: (l: ListDto) => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<'tasks' | 'blank'>('tasks');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await ctx.api<{ list: ListDto }>('/api/talk/lists', { method: 'POST', json: { action: 'create', channelId, name, template } });
      onCreated(res.list);
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('lists.new')}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-primary btn-sm" disabled={!name.trim() || busy} onClick={() => void submit()}>
          {t('lists.create')}
        </button>
      }
    >
      <form
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="ui-field">
          <span className="label">{t('lists.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder={t('lists.namePh')} />
        </label>
        <fieldset className="ui-field talk-radios">
          <legend className="label">{t('lists.template')}</legend>
          <label className="ui-check">
            <input type="radio" name="tpl" checked={template === 'tasks'} onChange={() => setTemplate('tasks')} />
            <span>{t('lists.templateTasks')}</span>
          </label>
          <label className="ui-check">
            <input type="radio" name="tpl" checked={template === 'blank'} onChange={() => setTemplate('blank')} />
            <span>{t('lists.templateBlank')}</span>
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}

function ListBody({ list: initial, channel, onChanged, onDeleted }: { list: ListDto; channel: TalkChannelDto; onChanged: () => void; onDeleted: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { api, toast, subscribe, personName } = ctx;
  const [list, setList] = useState(initial);
  const [items, setItems] = useState<ListItemDto[] | null>(null);
  const [viewId, setViewId] = useState<string>(() => readView(initial.id) ?? initial.views[0]?.id ?? 'table');
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const canWrite = list.canEdit;

  const load = useCallback(async () => {
    try {
      const res = await api<{ list: ListDto; items: ListItemDto[] }>(`/api/talk/lists?id=${encodeURIComponent(initial.id)}`);
      setList(res.list);
      setItems(res.items);
    } catch {
      setItems((cur) => cur ?? []);
    }
  }, [api, initial.id]);

  useEffect(() => {
    void load();
    void api<{ members: Array<{ userId: string }> }>(`/api/talk/channels/${channel.id}/members`)
      .then((r) => setMembers(r.members.map((m) => m.userId)))
      .catch(() => setMembers([]));
  }, [load, api, channel.id]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () =>
      subscribe((ev) => {
        if (ev.type !== 'events') return;
        if (!ev.events.some((e) => e.kind === 'list' && (e.payload as { listId?: string }).listId === initial.id && e.actorId !== ctx.boot.me)) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void load(), 250);
      }),
    [subscribe, initial.id, load, ctx.boot.me],
  );

  const view: ListView = list.views.find((v) => v.id === viewId) ?? list.views[0];

  async function post(json: Record<string, unknown>) {
    try {
      return await api<Record<string, unknown>>('/api/talk/lists', { method: 'POST', json: { listId: list.id, ...json } });
    } catch (err) {
      toast(errorText(t, err), 'error');
      return null;
    }
  }

  async function setValue(item: ListItemDto, fieldId: string, v: Value) {
    setItems((prev) => prev?.map((x) => (x.id === item.id ? { ...x, data: { ...x.data, [fieldId]: v } } : x)) ?? prev);
    if (!(await post({ action: 'updateItem', itemId: item.id, data: { [fieldId]: v } }))) void load();
  }

  async function setTitle(item: ListItemDto, title: string) {
    if (!title.trim() || title === item.title) return;
    setItems((prev) => prev?.map((x) => (x.id === item.id ? { ...x, title } : x)) ?? prev);
    if (!(await post({ action: 'updateItem', itemId: item.id, title }))) void load();
  }

  async function addItem(extra: Record<string, Value> = {}) {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle('');
    const res = await post({ action: 'addItem', title, data: extra });
    if (res?.item) setItems((prev) => [...(prev ?? []), res.item as ListItemDto]);
  }

  async function saveViews(views: ListView[], select?: string) {
    const res = await post({ action: 'update', views });
    if (res?.list) {
      setList(res.list as ListDto);
      if (select) {
        setViewId(select);
        writeView(list.id, select);
      }
    }
  }

  function patchView(patch: Partial<ListView>) {
    const views = list.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v));
    setList({ ...list, views });
    // La vista se guarda para todos (vistas guardadas); el filtro se escribe de a una letra.
    if (viewTimer.current) clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(() => void saveViews(views), 500);
  }
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shown = useMemo(() => {
    let rows = [...(items ?? [])];
    const q = (view.filter ?? '').trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q) || list.fields.some((f) => display(r.data[f.id] ?? null, f, personName).toLowerCase().includes(q)));
    if (view.sortBy) {
      const dir = view.sortDir === 'desc' ? -1 : 1;
      const key = (r: ListItemDto) => (view.sortBy === 'title' ? r.title : view.sortBy === 'created' ? r.createdAt : String(r.data[view.sortBy!] ?? ''));
      rows.sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }) * dir);
    }
    return rows;
  }, [items, view, list.fields, personName]);

  const groupField = view.kind === 'board' ? list.fields.find((f) => f.id === view.groupBy && f.type === 'select') : undefined;

  return (
    <div className="talk-list">
      <div className="talk-list-head">
        {renaming ? (
          <input
            className="input"
            defaultValue={list.name}
            autoFocus
            aria-label={t('lists.name')}
            onBlur={async (e) => {
              setRenaming(false);
              const name = e.target.value.trim();
              if (name && name !== list.name) {
                const res = await post({ action: 'update', name });
                if (res?.list) {
                  setList(res.list as ListDto);
                  onChanged();
                }
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <h2 className="talk-list-name">{list.name}</h2>
        )}
        <div className="talk-list-actions">
          {canWrite && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(true)}>
                {t('lists.rename')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFieldsOpen(true)}>
                {t('lists.fields')}
              </button>
            </>
          )}
          {list.canDelete && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)}>
              {t('lists.delete')}
            </button>
          )}
        </div>
      </div>
      <div className="talk-list-views">
        <div className="talk-list-viewtabs" role="tablist" aria-label={t('lists.views')}>
          {list.views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === view.id}
              className="talk-tab"
              onClick={() => {
                setViewId(v.id);
                writeView(list.id, v.id);
              }}
            >
              {v.name}
            </button>
          ))}
          {canWrite && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const id = Math.random().toString(36).slice(2, 10);
                const board = list.fields.some((f) => f.type === 'select');
                void saveViews([...list.views, { id, name: board ? t('lists.boardView') : t('lists.tableView'), kind: board ? 'board' : 'table', sortDir: 'asc', filter: '' }], id);
              }}
            >
              {t('lists.newView')}
            </button>
          )}
        </div>
        <div className="talk-list-controls">
          <input className="input" type="search" placeholder={t('lists.filter')} aria-label={t('lists.filter')} value={view.filter ?? ''} onChange={(e) => patchView({ filter: e.target.value })} disabled={!canWrite} />
          <select className="select" aria-label={t('lists.viewKind')} value={view.kind} disabled={!canWrite} onChange={(e) => patchView({ kind: e.target.value as ListView['kind'] })}>
            <option value="table">{t('lists.tableView')}</option>
            <option value="board">{t('lists.boardView')}</option>
          </select>
          {view.kind === 'board' && (
            <select className="select" aria-label={t('lists.groupBy')} value={view.groupBy ?? ''} disabled={!canWrite} onChange={(e) => patchView({ groupBy: e.target.value || null })}>
              {list.fields
                .filter((f) => f.type === 'select')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {t('lists.groupByField', { name: f.name })}
                  </option>
                ))}
            </select>
          )}
          <select className="select" aria-label={t('lists.sort')} value={view.sortBy ?? ''} disabled={!canWrite} onChange={(e) => patchView({ sortBy: e.target.value || null })}>
            <option value="">{t('lists.sortManual')}</option>
            <option value="title">{t('lists.sortTitle')}</option>
            <option value="created">{t('lists.sortCreated')}</option>
            {list.fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {view.sortBy && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!canWrite} onClick={() => patchView({ sortDir: view.sortDir === 'desc' ? 'asc' : 'desc' })} aria-label={t('lists.sortDir')}>
              {view.sortDir === 'desc' ? '↓' : '↑'}
            </button>
          )}
          {canWrite && list.views.length > 1 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const rest = list.views.filter((v) => v.id !== view.id);
                void saveViews(rest, rest[0].id);
              }}
            >
              {t('lists.deleteView')}
            </button>
          )}
        </div>
      </div>
      {items === null ? (
        <div className="ui-loading-stack talk-loading" aria-busy="true" aria-label={t('common.loading')}>
          <div className="ui-skeleton ui-skeleton-row" />
        </div>
      ) : view.kind === 'board' && groupField ? (
        <div className="talk-board" role="list">
          {[...(groupField.options ?? []), ''].map((opt) => {
            const col = shown.filter((r) => String(r.data[groupField.id] ?? '') === opt);
            return (
              <section key={opt || '_none'} className="talk-board-col" role="listitem" aria-label={opt || t('lists.none')}>
                <h3 className="talk-board-col-head">
                  {opt || t('lists.none')} <span className="talk-muted">{col.length}</span>
                </h3>
                {col.map((r) => (
                  <article key={r.id} className="talk-board-card">
                    <button type="button" className="talk-board-card-title" onClick={() => setOpenItem(r.id)}>
                      {r.title}
                    </button>
                    <div className="talk-board-card-meta">
                      {list.fields
                        .filter((f) => f.id !== groupField.id && r.data[f.id] !== null && r.data[f.id] !== undefined && r.data[f.id] !== '')
                        .slice(0, 3)
                        .map((f) =>
                          f.type === 'person' ? (
                            <span key={f.id} className="talk-board-person">
                              <Avatar id={String(r.data[f.id])} size={16} />
                              {personName(String(r.data[f.id]))}
                            </span>
                          ) : (
                            <span key={f.id} className="talk-muted">
                              {display(r.data[f.id] ?? null, f, personName)}
                            </span>
                          ),
                        )}
                      {r.comments > 0 && <span className="talk-muted">{t('lists.commentsCount', { count: r.comments })}</span>}
                    </div>
                    {canWrite && (
                      <FieldInput field={groupField} value={r.data[groupField.id] ?? null} members={members} disabled={false} label={groupField.name} onChange={(v) => void setValue(r, groupField.id, v)} />
                    )}
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="talk-table-wrap">
          <table className="talk-table">
            <thead>
              <tr>
                <th scope="col">{t('lists.itemTitle')}</th>
                {list.fields.map((f) => (
                  <th key={f.id} scope="col">
                    {f.name}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">{t('lists.comments')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={list.fields.length + 2} className="talk-muted">
                    {(view.filter ?? '').trim() ? t('lists.noMatches') : t('lists.noItems')}
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    {canWrite ? (
                      <input
                        key={`${r.id}:${r.title}`}
                        className="input talk-list-cell-input is-title"
                        defaultValue={r.title}
                        aria-label={t('lists.itemTitle')}
                        onBlur={(e) => void setTitle(r, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                    ) : (
                      r.title
                    )}
                  </td>
                  {list.fields.map((f) => (
                    <td key={f.id}>
                      {canWrite ? (
                        <FieldInput key={`${r.id}:${f.id}:${String(r.data[f.id] ?? '')}`} field={f} value={r.data[f.id] ?? null} members={members} disabled={false} label={`${f.name}: ${r.title}`} onChange={(v) => void setValue(r, f.id, v)} />
                      ) : (
                        display(r.data[f.id] ?? null, f, personName)
                      )}
                    </td>
                  ))}
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenItem(r.id)} aria-label={t('lists.openItem', { title: r.title })}>
                      {r.comments > 0 ? t('lists.commentsCount', { count: r.comments }) : t('lists.open')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canWrite && (
        <form
          className="talk-list-add"
          onSubmit={(e) => {
            e.preventDefault();
            void addItem();
          }}
        >
          <input className="input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t('lists.addItem')} aria-label={t('lists.addItem')} maxLength={500} data-testid="talk-list-add" />
          <button type="submit" className="btn btn-sm" disabled={!newTitle.trim()}>
            {t('lists.add')}
          </button>
        </form>
      )}
      {openItem && items && items.find((i) => i.id === openItem) && (
        <ItemPanel
          list={list}
          item={items.find((i) => i.id === openItem)!}
          members={members}
          canWrite={canWrite}
          onValue={(f, v) => void setValue(items.find((i) => i.id === openItem)!, f, v)}
          onTitle={(title) => void setTitle(items.find((i) => i.id === openItem)!, title)}
          onClose={() => setOpenItem(null)}
          onDelete={async () => {
            const id = openItem;
            setOpenItem(null);
            if (await post({ action: 'deleteItem', itemId: id })) setItems((prev) => prev?.filter((x) => x.id !== id) ?? prev);
          }}
          onComments={(n) => setItems((prev) => prev?.map((x) => (x.id === openItem ? { ...x, comments: n } : x)) ?? prev)}
        />
      )}
      {fieldsOpen && (
        <FieldsDialog
          fields={list.fields}
          onClose={() => setFieldsOpen(false)}
          onSave={async (fields) => {
            const res = await post({ action: 'update', fields });
            if (res?.list) {
              setList(res.list as ListDto);
              setFieldsOpen(false);
              toast(t('dialogs.saved'));
            }
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          open
          danger
          title={t('lists.deleteTitle', { name: list.name })}
          body={t('lists.deleteBody')}
          confirmLabel={t('lists.delete')}
          cancelLabel={t('common.cancel')}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            if (await post({ action: 'delete' })) {
              toast(t('lists.deleted'));
              onDeleted();
            }
          }}
        />
      )}
    </div>
  );
}

function ItemPanel(props: {
  list: ListDto;
  item: ListItemDto;
  members: string[];
  canWrite: boolean;
  onValue: (fieldId: string, v: Value) => void;
  onTitle: (title: string) => void;
  onClose: () => void;
  onDelete: () => void;
  onComments: (n: number) => void;
}) {
  const { list, item, members, canWrite } = props;
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [comments, setComments] = useState<ListCommentDto[] | null>(null);
  const [body, setBody] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await ctx.api<{ comments: ListCommentDto[] }>(`/api/talk/lists?id=${encodeURIComponent(list.id)}&item=${encodeURIComponent(item.id)}`);
      setComments(r.comments);
    } catch {
      setComments([]);
    }
  }, [ctx, list.id, item.id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(
    () =>
      ctx.subscribe((ev) => {
        if (ev.type === 'events' && ev.events.some((e) => e.kind === 'list' && (e.payload as { itemId?: string }).itemId === item.id && e.actorId !== ctx.boot.me)) void load();
      }),
    [ctx, item.id, load],
  );
  async function send() {
    const text = body.trim();
    if (!text) return;
    try {
      const r = await ctx.api<{ comment: ListCommentDto }>('/api/talk/lists', { method: 'POST', json: { action: 'comment', listId: list.id, itemId: item.id, body: text } });
      setBody('');
      setComments((prev) => {
        const next = [...(prev ?? []), r.comment];
        props.onComments(next.length);
        return next;
      });
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  return (
    <Modal
      title={item.title}
      onClose={props.onClose}
      wide
      foot={
        canWrite ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onDelete}>
            {t('lists.deleteItem')}
          </button>
        ) : undefined
      }
    >
      <div className="ui-fields">
        {canWrite && (
          <label className="ui-field">
            <span className="label">{t('lists.itemTitle')}</span>
            <input className="input" defaultValue={item.title} onBlur={(e) => props.onTitle(e.target.value)} maxLength={500} />
          </label>
        )}
        {list.fields.map((f) => (
          <label key={f.id} className="ui-field">
            <span className="label">{f.name}</span>
            {canWrite ? (
              <FieldInput field={f} value={item.data[f.id] ?? null} members={members} disabled={false} label={f.name} onChange={(v) => props.onValue(f.id, v)} />
            ) : (
              <span>{display(item.data[f.id] ?? null, f, ctx.personName) || t('lists.none')}</span>
            )}
          </label>
        ))}
        <section className="talk-item-thread" aria-label={t('lists.comments')}>
          <h3 className="label">{t('lists.comments')}</h3>
          {comments === null ? (
            <p className="talk-muted">{t('common.loading')}</p>
          ) : comments.length === 0 ? (
            <p className="talk-muted">{t('lists.noComments')}</p>
          ) : (
            <ul className="talk-item-comments">
              {comments.map((c) => (
                <li key={c.id} className="talk-item-comment">
                  <Avatar id={c.userId} size={22} />
                  <div>
                    <p className="talk-item-comment-head">
                      <span className="talk-msg-author">{ctx.personName(c.userId)}</span> <span className="talk-muted">{fmtFull(c.createdAt, ctx.locale)}</span>
                    </p>
                    <p className="talk-item-comment-body">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <form
              className="talk-list-add"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('lists.commentPh')} aria-label={t('lists.commentPh')} maxLength={4000} />
              <button type="submit" className="btn btn-sm" disabled={!body.trim()}>
                {t('lists.send')}
              </button>
            </form>
          )}
        </section>
      </div>
    </Modal>
  );
}

function FieldsDialog({ fields: initial, onClose, onSave }: { fields: ListField[]; onClose: () => void; onSave: (f: ListField[]) => void }) {
  const t = useTranslations('talk');
  const [fields, setFields] = useState<Array<ListField & { optionsText?: string }>>(initial.map((f) => ({ ...f, optionsText: (f.options ?? []).join(', ') })));
  const set = (i: number, patch: Partial<ListField & { optionsText?: string }>) => setFields((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <Modal
      title={t('lists.fields')}
      onClose={onClose}
      wide
      foot={
        <>
          <button
            type="button"
            className="btn btn-sm"
            disabled={fields.length >= 20}
            onClick={() => setFields((prev) => [...prev, { id: Math.random().toString(36).slice(2, 10), name: '', type: 'text', optionsText: '' }])}
          >
            {t('lists.addField')}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              onSave(
                fields
                  .filter((f) => f.name.trim())
                  .map((f) => ({
                    id: f.id,
                    name: f.name.trim(),
                    type: f.type,
                    ...(f.type === 'select' ? { options: (f.optionsText ?? '').split(',').map((o) => o.trim()).filter(Boolean) } : {}),
                  })),
              )
            }
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <ul className="talk-fields-edit">
        {fields.map((f, i) => (
          <li key={f.id} className="talk-fields-row">
            <input className="input" value={f.name} onChange={(e) => set(i, { name: e.target.value })} placeholder={t('lists.fieldName')} aria-label={t('lists.fieldName')} maxLength={60} />
            <select className="select" value={f.type} onChange={(e) => set(i, { type: e.target.value as ListFieldType })} aria-label={t('lists.fieldType')}>
              {FIELD_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`lists.type_${ty}`)}
                </option>
              ))}
            </select>
            {f.type === 'select' && (
              <input className="input" value={f.optionsText ?? ''} onChange={(e) => set(i, { optionsText: e.target.value })} placeholder={t('lists.optionsPh')} aria-label={t('lists.options')} />
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))} aria-label={t('lists.removeField', { name: f.name || '…' })}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
