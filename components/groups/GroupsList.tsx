'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import EmptyState from '@/components/ui/EmptyState';
import type { ChatDto, LabelDto, NumberDto, PropertyDef } from '@/lib/groups';
import { PropertyValueText, filterOptions } from './PropertyInput';
import { ChatPlate, LabelTag, Modal, NumberOptions, api, defaultNumberId, useErrorText, useRelativeTime, useToast } from './ui';

const COLUMNS_STORE = 'zs-groups-columns';

type BulkAction = 'add' | 'remove' | 'promote' | 'demote';

interface CreateResult {
  name: string;
  ok: boolean;
  chatId?: string;
  error?: string;
  notAdded?: string[];
}

interface BulkResult {
  chatId: string;
  name: string;
  ok: boolean;
  error?: string;
  results: Array<{ phone: string; ok: boolean; error?: string }>;
}

/**
 * Lista de grupos: búsqueda, etiquetas, selección para acciones en lote
 * (agregar, quitar, promover o degradar miembros; envío masivo) y crear
 * grupos, uno o muchos desde un CSV.
 */
export default function GroupsList({
  numbers,
  labels,
  properties,
  openNew,
  initial,
}: {
  initial: ChatDto[];
  numbers: NumberDto[];
  labels: LabelDto[];
  properties: PropertyDef[];
  openNew: boolean;
}) {
  const t = useTranslations('groups');
  const rel = useRelativeTime();
  const router = useRouter();
  const [toast, showToast] = useToast();
  const groupNumbers = useMemo(() => numbers.filter((n) => n.caps.groups), [numbers]);
  const [rows, setRows] = useState<ChatDto[] | null>(initial);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(openNew);
  const [csvOpen, setCsvOpen] = useState(false);
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [propKey, setPropKey] = useState('');
  const [propValue, setPropValue] = useState('');
  const [columnsOpen, setColumnsOpen] = useState(false);
  // Columnas de propiedades visibles (por persona, en este navegador). Por defecto, las dos primeras.
  const [columns, setColumns] = useState<string[]>(() => properties.slice(0, 2).map((p) => p.key));
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLUMNS_STORE);
      if (raw) setColumns((JSON.parse(raw) as string[]).filter((k) => properties.some((p) => p.key === k)));
    } catch {
      // Sin storage: las columnas por defecto.
    }
  }, [properties]);
  const toggleColumn = (key: string) =>
    setColumns((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem(COLUMNS_STORE, JSON.stringify(next));
      } catch {
        // Sin storage: dura lo que la página.
      }
      return next;
    });
  const shownProps = properties.filter((p) => columns.includes(p.key));
  const propDef = properties.find((p) => p.key === propKey) ?? null;

  const load = useCallback(async () => {
    const p = new URLSearchParams({ kind: 'group', limit: '200' });
    if (q.trim()) p.set('q', q.trim());
    if (label) p.set('label', label);
    if (propKey) p.set('props', JSON.stringify([propValue ? { key: propKey, op: 'is', value: propValue } : { key: propKey, op: 'set' }]));
    const [open, closed] = await Promise.all([
      api<{ rows: ChatDto[] }>(`/api/groups/chats?${p}`),
      api<{ rows: ChatDto[] }>(`/api/groups/chats?${p}&filter=closed`),
    ]);
    if (!open.data) {
      setError(true);
      setRows((r) => r ?? []);
      return;
    }
    setError(false);
    setRows([...open.data.rows, ...(closed.data?.rows ?? [])]);
  }, [q, label, propKey, propValue]);

  // La primera página viene del servidor; se vuelve a pedir al buscar o filtrar.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => void load(), 200);
    return () => clearTimeout(id);
  }, [load]);

  useKeyShortcut('c', () => setCreateOpen(true));

  const allSelected = rows !== null && rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (numbers.length === 0) {
    return (
      <EmptyState
        title={t('list.noNumbersTitle')}
        body={t('list.noNumbersBody')}
        action={{ label: t('inbox.connect'), href: '/app/groups/settings?tab=numbers&new=1' }}
        product="groups"
      />
    );
  }

  return (
    <>
      <div className="gr-toolbar">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('list.search')} aria-label={t('list.search')} />
        <select className="select" value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t('inbox.label')}>
          <option value="">{t('inbox.labelAll')}</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {properties.length > 0 && (
          <select
            className="select"
            value={propKey}
            onChange={(e) => {
              setPropKey(e.target.value);
              setPropValue('');
            }}
            aria-label={t('lists.property')}
          >
            <option value="">{t('lists.anyProperty')}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        {propDef &&
          (filterOptions(propDef).length > 0 ? (
            <select className="select" value={propValue} onChange={(e) => setPropValue(e.target.value)} aria-label={t('lists.propertyValue')}>
              <option value="">{t('lists.hasValue')}</option>
              {filterOptions(propDef).map((o) => (
                <option key={o} value={o}>
                  {o === 'true' && propDef.type === 'checkbox' ? t('props.yes') : o}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" value={propValue} onChange={(e) => setPropValue(e.target.value)} placeholder={t('lists.hasValue')} aria-label={t('lists.propertyValue')} />
          ))}
        {properties.length > 0 && (
          <div className="gr-columns">
            <button type="button" className="btn btn-ghost" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((v) => !v)}>
              {t('list.columns')}
            </button>
            {columnsOpen && (
              <div
                className="gr-columns-menu"
                role="group"
                aria-label={t('list.columns')}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setColumnsOpen(false);
                }}
              >
                {properties.map((p) => (
                  <label key={p.id} className="gr-check-label">
                    <input type="checkbox" className="ui-check" checked={columns.includes(p.key)} onChange={() => toggleColumn(p.key)} />
                    {p.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <span className="gr-toolbar-spacer" />
        <Link href="/app/groups/templates" className="btn btn-secondary">
          {t('templates.title')}
        </Link>
        <button type="button" className="btn btn-secondary" onClick={() => setJoinOpen(true)} disabled={groupNumbers.length === 0}>
          {t('join.button')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setCsvOpen(true)} disabled={groupNumbers.length === 0}>
          {t('list.importCsv')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)} disabled={groupNumbers.length === 0}>
          {t('list.new')} <kbd className="kbd">C</kbd>
        </button>
      </div>
      {groupNumbers.length === 0 && <p className="gr-banner">{t('list.needsBridge')}</p>}

      {selected.size > 0 && (
        <div className="gr-bulkbar" role="toolbar" aria-label={t('list.bulkLabel')}>
          <strong>{t('list.selected', { n: selected.size })}</strong>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBulk('add')}>
            {t('list.bulkAdd')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBulk('remove')}>
            {t('list.bulkRemove')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBulk('promote')}>
            {t('list.bulkPromote')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBulk('demote')}>
            {t('list.bulkDemote')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSettingsOpen(true)}>
            {t('bulk.settings')}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => router.push(`/app/groups/broadcasts/new?chats=${[...selected].join(',')}`)}
          >
            {t('list.bulkBroadcast')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            {t('list.clear')}
          </button>
        </div>
      )}

      {error && (
        <div className="gr-error" role="alert">
          {t('list.loadError')}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {rows === null ? (
        <div className="ui-loading-stack" aria-busy="true" aria-label={t('common.loading')}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          quiet
          title={q || label || propKey ? t('list.noResults') : t('list.emptyTitle')}
          body={q || label || propKey ? undefined : t('list.emptyBody')}
          action={
            q || label || propKey || groupNumbers.length === 0 ? undefined : (
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                {t('list.new')}
              </button>
            )
          }
          product="groups"
        />
      ) : (
        <div className="table-wrap">
          <table className="table gr-table">
            <thead>
              <tr>
                <th className="gr-check-col">
                  <input
                    type="checkbox"
                    className="ui-check"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    aria-label={t('list.selectAll')}
                  />
                </th>
                <th>{t('list.colName')}</th>
                <th className="num">{t('list.colMembers')}</th>
                <th>{t('list.colLabels')}</th>
                {shownProps.map((p) => (
                  <th key={p.id} className="gr-hide-sm">
                    {p.label}
                  </th>
                ))}
                <th className="gr-hide-sm">{t('list.colActivity')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="gr-check-col">
                    <input type="checkbox" className="ui-check" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={t('list.select', { name: c.name })} />
                  </td>
                  <td>
                    <Link href={`/app/groups/list/${c.id}`} className="gr-table-name">
                      <ChatPlate name={c.name} kind="group" />
                      <span>{c.name}</span>
                      {c.leftAt ? (
                        <span className="badge badge-outline">{t('groupSettings.leftTag')}</span>
                      ) : (
                        c.status === 'closed' && <span className="badge badge-outline">{t('list.closed')}</span>
                      )}
                      {c.flagged && <span className="badge badge-bad">{t('inbox.flagged')}</span>}
                    </Link>
                  </td>
                  <td className="num">{c.memberCount}</td>
                  <td>
                    <span className="gr-label-row">
                      {c.labels.map((l) => (
                        <LabelTag key={l.id} name={l.name} color={l.color} />
                      ))}
                    </span>
                  </td>
                  {shownProps.map((p) => (
                    <td key={p.id} className="gr-hide-sm">
                      <PropertyValueText def={p} value={c.properties[p.key]} />
                    </td>
                  ))}
                  <td className="gr-hide-sm ui-help">{rel(c.lastMessageAt ?? c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateGroupModal
        open={createOpen}
        numbers={groupNumbers}
        labels={labels}
        onClose={() => {
          setCreateOpen(false);
          if (openNew) router.replace('/app/groups/list');
        }}
        onCreated={(id) => {
          setCreateOpen(false);
          showToast(t('list.created'));
          router.push(`/app/groups/list/${id}`);
        }}
      />
      <CsvModal open={csvOpen} numbers={groupNumbers} onClose={() => setCsvOpen(false)} onDone={() => void load()} />
      <BulkSettingsModal
        open={settingsOpen}
        chats={(rows ?? []).filter((r) => selected.has(r.id))}
        onClose={() => setSettingsOpen(false)}
        onDone={() => void load()}
      />
      <JoinModal
        open={joinOpen}
        numbers={groupNumbers}
        onClose={() => setJoinOpen(false)}
        onJoined={(id) => {
          setJoinOpen(false);
          showToast(t('join.done'));
          router.push(`/app/groups/list/${id}`);
        }}
      />
      <BulkModal
        action={bulk}
        chatIds={[...selected]}
        onClose={() => setBulk(null)}
        onDone={() => {
          void load();
        }}
      />
      {toast}
    </>
  );
}

function CreateGroupModal({
  open,
  numbers,
  labels,
  onClose,
  onCreated,
}: {
  open: boolean;
  numbers: NumberDto[];
  labels: LabelDto[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [numberId, setNumberId] = useState('');
  const [name, setName] = useState('');
  const [phones, setPhones] = useState('');
  const [description, setDescription] = useState('');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setNumberId(defaultNumberId(numbers));
      setName('');
      setPhones('');
      setDescription('');
      setLabelIds([]);
      setError('');
    }
    // Solo al abrir: un re-render del padre no borra lo escrito ni el resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    const res = await api<{ results: CreateResult[] }>('/api/groups/create', {
      body: { numberId, name, phones: phones.split(/[\n,;]+/).filter(Boolean), description, labelIds },
    });
    setBusy(false);
    const r = res.data?.results[0];
    if (!r?.ok || !r.chatId) {
      setError(errText(res.error ?? r?.error ?? 'generic'));
      return;
    }
    onCreated(r.chatId);
  }

  return (
    <Modal
      open={open}
      title={t('list.newTitle')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || !numberId} aria-busy={busy || undefined}>
            {t('list.create')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        {numbers.length > 0 && (
          <label className="ui-field">
            <span className="label">{t('list.fromNumber')}</span>
            <select className="select" value={numberId} onChange={(e) => setNumberId(e.target.value)}>
              <NumberOptions numbers={numbers} />
            </select>
          </label>
        )}
        <label className="ui-field">
          <span className="label">{t('list.groupName')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus required placeholder={t('list.groupNamePlaceholder')} />
        </label>
        <label className="ui-field">
          <span className="label">{t('list.participants')}</span>
          <textarea className="textarea" rows={3} value={phones} onChange={(e) => setPhones(e.target.value)} placeholder="+5491155550000, +15550001111" />
          <span className="ui-help">{t('list.participantsHelp')}</span>
        </label>
        <label className="ui-field">
          <span className="label">{t('list.description')}</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>
        {labels.length > 0 && (
          <fieldset className="ui-field">
            <legend className="label">{t('details.labels')}</legend>
            <div className="gr-label-picker">
              {labels.map((l) => {
                const on = labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`gr-label-toggle${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setLabelIds(on ? labelIds.filter((x) => x !== l.id) : [...labelIds, l.id])}
                  >
                    <LabelTag name={l.name} color={l.color} />
                  </button>
                );
              })}
            </div>
          </fieldset>
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

function CsvModal({ open, numbers, onClose, onDone }: { open: boolean; numbers: NumberDto[]; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [numberId, setNumberId] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{ rows: Array<{ name: string; phones: string[] }>; errors: Array<{ line: number; error: string }> } | null>(null);
  const [results, setResults] = useState<CreateResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setNumberId(defaultNumberId(numbers));
      setCsv('');
      setPreview(null);
      setResults(null);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function check() {
    setError('');
    const res = await api<{ rows: Array<{ name: string; phones: string[] }>; errors: Array<{ line: number; error: string }> }>('/api/groups/create', {
      body: { numberId, csv, preview: true },
    });
    if (res.data) setPreview(res.data);
    else setError(errText(res.error));
  }

  async function run() {
    setBusy(true);
    setError('');
    const res = await api<{ results: CreateResult[] }>('/api/groups/create', { body: { numberId, csv } });
    setBusy(false);
    if (!res.data) {
      setError(errText(res.error));
      return;
    }
    setResults(res.data.results);
    onDone();
  }

  const ok = results?.filter((r) => r.ok).length ?? 0;
  return (
    <Modal
      open={open}
      wide
      title={t('csv.title')}
      onClose={onClose}
      onSubmit={() => void (results ? onClose() : preview ? run() : check())}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {results ? t('common.close') : t('common.cancel')}
          </button>
          {!results && (
            <button type="submit" className="btn btn-primary" disabled={!csv.trim() || (preview !== null && preview.rows.length === 0)} aria-busy={busy || undefined}>
              {preview ? t('csv.create', { n: preview.rows.length }) : t('csv.check')}
            </button>
          )}
        </>
      }
    >
      <div className="ui-fields">
        {results ? (
          <>
            <p role="status">{t('csv.done', { ok, total: results.length })}</p>
            <ul className="gr-mini-list">
              {results.map((r, i) => (
                <li key={`${r.name}-${i}`}>
                  {r.ok && r.chatId ? <Link href={`/app/groups/list/${r.chatId}`}>{r.name}</Link> : <span>{r.name || '—'}</span>}
                  {r.ok ? (
                    r.notAdded && r.notAdded.length > 0 ? (
                      <span className="badge badge-warn">{t('csv.notAdded', { n: r.notAdded.length })}</span>
                    ) : (
                      <span className="badge badge-ok">{t('csv.ok')}</span>
                    )
                  ) : (
                    <span className="badge badge-bad">{errText(r.error)}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {numbers.length > 0 && (
              <label className="ui-field">
                <span className="label">{t('list.fromNumber')}</span>
                <select className="select" value={numberId} onChange={(e) => setNumberId(e.target.value)}>
                  <NumberOptions numbers={numbers} />
                </select>
              </label>
            )}
            <label className="ui-field">
              <span className="label">{t('csv.file')}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setCsv(await f.text());
                    setPreview(null);
                  }
                }}
              />
            </label>
            <label className="ui-field">
              <span className="label">{t('csv.paste')}</span>
              <textarea
                className="textarea gr-mono"
                rows={6}
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setPreview(null);
                }}
                placeholder={'name,participants,description\nAcme support,+5491155550000 +5491155550001,Account team'}
              />
              <span className="ui-help">{t('csv.help')}</span>
            </label>
            {preview && (
              <div role="status">
                <p>{t('csv.preview', { n: preview.rows.length })}</p>
                <ul className="gr-mini-list">
                  {preview.rows.slice(0, 10).map((r, i) => (
                    <li key={`${r.name}-${i}`}>
                      <span>{r.name}</span>
                      <span className="ui-help">{t('csv.participants', { n: r.phones.length })}</span>
                    </li>
                  ))}
                </ul>
                {preview.errors.length > 0 && (
                  <ul className="gr-mini-list">
                    {preview.errors.map((e) => (
                      <li key={`${e.line}-${e.error}`} className="ui-error">
                        {t('csv.lineError', { line: e.line, error: errText(e.error) })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
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

function BulkModal({ action, chatIds, onClose, onDone }: { action: BulkAction | null; chatIds: string[]; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [phones, setPhones] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (action) {
      setPhones('');
      setResults(null);
      setError('');
    }
  }, [action]);
  const summary = useMemo(() => {
    if (!results) return null;
    const groupsOk = results.filter((r) => r.ok).length;
    const failedPhones = results.flatMap((r) => r.results.filter((x) => !x.ok));
    return { groupsOk, failedPhones: failedPhones.length };
  }, [results]);

  async function submit() {
    if (results) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    const res = await api<{ results: BulkResult[] }>('/api/groups/members', {
      body: { chatIds, action, phones: phones.split(/[\n,;]+/).filter(Boolean) },
    });
    setBusy(false);
    if (!res.data) {
      setError(errText(res.error));
      return;
    }
    setResults(res.data.results);
    onDone();
  }

  return (
    <Modal
      open={!!action}
      title={action ? t(`bulk.title.${action}`, { n: chatIds.length }) : ''}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {results ? t('common.close') : t('common.cancel')}
          </button>
          {!results && (
            <button type="submit" className="btn btn-primary" disabled={!phones.trim()} aria-busy={busy || undefined}>
              {t('bulk.run')}
            </button>
          )}
        </>
      }
    >
      <div className="ui-fields">
        {results && summary ? (
          <>
            <p role="status">{t('bulk.done', { ok: summary.groupsOk, total: results.length, failed: summary.failedPhones })}</p>
            <ul className="gr-mini-list">
              {results.map((r) => (
                <li key={r.chatId}>
                  <span>{r.name}</span>
                  {r.ok ? (
                    r.results.some((x) => !x.ok) ? (
                      <span className="badge badge-warn">
                        {t('bulk.partial', { phones: r.results.filter((x) => !x.ok).map((x) => `+${x.phone}`).join(', ') })}
                      </span>
                    ) : (
                      <span className="badge badge-ok">{t('csv.ok')}</span>
                    )
                  ) : (
                    <span className="badge badge-bad">{errText(r.error)}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <label className="ui-field">
            <span className="label">{t('bulk.phones')}</span>
            <textarea className="textarea" rows={4} value={phones} onChange={(e) => setPhones(e.target.value)} autoFocus placeholder="+5491155550000, +15550001111" />
            <span className="ui-help">{action === 'add' ? t('bulk.addHelp') : t('bulk.help')}</span>
          </label>
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

/** Entrar a un grupo con su link de invitación desde un número. */
function JoinModal({ open, numbers, onClose, onJoined }: { open: boolean; numbers: NumberDto[]; onClose: () => void; onJoined: (id: string) => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [numberId, setNumberId] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setNumberId(defaultNumberId(numbers));
    setInvite('');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    if (!invite.trim()) return;
    setBusy(true);
    setError('');
    const r = await api<ChatDto>('/api/groups/join', { body: { numberId, invite } });
    setBusy(false);
    if (!r.data) return setError(errText(r.error));
    onJoined(r.data.id);
  }

  return (
    <Modal
      open={open}
      title={t('join.title')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!invite.trim() || !numberId} aria-busy={busy || undefined}>
            {t('join.submit')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        {numbers.length > 0 && (
          <label className="ui-field">
            <span className="label">{t('list.fromNumber')}</span>
            <select className="select" value={numberId} onChange={(e) => setNumberId(e.target.value)}>
              <NumberOptions numbers={numbers} />
            </select>
          </label>
        )}
        <label className="ui-field">
          <span className="label">{t('join.link')}</span>
          <input className="input" value={invite} onChange={(e) => setInvite(e.target.value)} autoFocus required placeholder="chat.whatsapp.com/AbCdEf123" maxLength={300} />
          <span className="ui-help">{t('join.help')}</span>
        </label>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Duraciones de los mensajes temporales (las mismas que el ajuste de un grupo). */
const BULK_EPHEMERAL = [0, 86_400, 604_800, 7_776_000] as const;

/** Solo admins escriben o editan y mensajes temporales, en varios grupos a la vez (con resultado por grupo). */
function BulkSettingsModal({ open, chats, onClose, onDone }: { open: boolean; chats: ChatDto[]; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [announce, setAnnounce] = useState('');
  const [locked, setLocked] = useState('');
  const [ephemeral, setEphemeral] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; name: string; error: string | null }> | null>(null);
  useEffect(() => {
    if (!open) return;
    setAnnounce('');
    setLocked('');
    setEphemeral('');
    setResults(null);
  }, [open]);

  async function submit() {
    if (results) return onClose();
    const body: Record<string, unknown> = { action: 'settings' };
    if (announce) body.announce = announce === 'on';
    if (locked) body.locked = locked === 'on';
    if (ephemeral) body.ephemeral = Number(ephemeral);
    setBusy(true);
    const out: Array<{ id: string; name: string; error: string | null }> = [];
    for (const c of chats) {
      const r = await api(`/api/groups/chats/${c.id}/group`, { body });
      out.push({ id: c.id, name: c.name, error: r.data ? null : r.error });
    }
    setBusy(false);
    setResults(out);
    onDone();
  }

  const pick = (value: string, set: (v: string) => void, label: string) => (
    <label className="ui-field">
      <span className="label">{label}</span>
      <select className="select" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">{t('bulk.keep')}</option>
        <option value="on">{t('bulk.on')}</option>
        <option value="off">{t('bulk.off')}</option>
      </select>
    </label>
  );

  return (
    <Modal
      open={open}
      title={t('bulk.settingsTitle', { n: chats.length })}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {results ? t('common.close') : t('common.cancel')}
          </button>
          {!results && (
            <button type="submit" className="btn btn-primary" disabled={!announce && !locked && !ephemeral} aria-busy={busy || undefined}>
              {t('bulk.run')}
            </button>
          )}
        </>
      }
    >
      <div className="ui-fields">
        {results ? (
          <>
            <p role="status">{t('bulk.settingsDone', { ok: results.filter((r) => !r.error).length, total: results.length })}</p>
            <ul className="gr-mini-list">
              {results.map((r) => (
                <li key={r.id}>
                  <span>{r.name}</span>
                  {r.error ? <span className="badge badge-bad">{errText(r.error)}</span> : <span className="badge badge-ok">{t('csv.ok')}</span>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {pick(announce, setAnnounce, t('groupSettings.announce'))}
            {pick(locked, setLocked, t('groupSettings.locked'))}
            <label className="ui-field">
              <span className="label">{t('groupSettings.ephemeral')}</span>
              <select className="select" value={ephemeral} onChange={(e) => setEphemeral(e.target.value)}>
                <option value="">{t('bulk.keep')}</option>
                {BULK_EPHEMERAL.map((sec) => (
                  <option key={sec} value={String(sec)}>
                    {t(`groupSettings.ephemeralOptions.${sec}`)}
                  </option>
                ))}
              </select>
            </label>
            <p className="ui-help">{t('groupSettings.help')}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
