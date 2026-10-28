'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useLocale, useNow, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';
import RowMenu from '@/components/notes/RowMenu';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import type { FlowListItem, FlowSettingsDto } from '@/lib/flow';
import type { FlowFolderDto } from '@/lib/flow-folders';
import { FLOW_TEMPLATES, RETENTION_DAYS, triggerNode } from '@/lib/flow-schema';
import { exportFileName, exportFlowJson, parseFlowImport } from '@/lib/flow-transfer';
import { i18nKey, RUN_BADGE } from './flow-ui';
import { parseDbUtc } from '@/lib/utils';

interface Props {
  flows: FlowListItem[];
  folders: FlowFolderDto[];
  canEdit: boolean;
  settings: FlowSettingsDto;
}

const STATUS_FILTERS = ['all', 'on', 'off', 'failing', 'held', 'draft'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Descarga un texto como archivo (exportar un flow). */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lista de flows con carpetas, búsqueda y filtros, más importar, armar con IA y plantillas (/app/flow). */
export default function FlowsHome({ flows: initial, folders: initialFolders, canEdit, settings: initialSettings }: Props) {
  const t = useTranslations('flow');
  const locale = useLocale();
  const [retention, setRetention] = useState(initialSettings.retentionDays);
  const [settingsState, setSettingsState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const router = useRouter();
  const [flows, setFlows] = useState(initial);
  const [folders, setFolders] = useState(initialFolders);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const autoCreated = useRef(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [folder, setFolder] = useState<string>(() => {
    const f = params.get('folder') ?? '';
    return initialFolders.some((x) => x.id === f) ? f : '';
  });
  // Menú "…" por fila: renombrar (modal), duplicar, mover, exportar y eliminar.
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<FlowListItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FlowListItem | null>(null);
  const [rowBusy, setRowBusy] = useState(false);
  const [moving, setMoving] = useState<FlowListItem | null>(null);
  const [moveTo, setMoveTo] = useState('');
  // Carpetas: crear / renombrar (mismo modal) y borrar.
  const [folderEdit, setFolderEdit] = useState<FlowFolderDto | 'new' | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderDeleting, setFolderDeleting] = useState<FlowFolderDto | null>(null);
  const [folderMenu, setFolderMenu] = useState(false);
  // Importar JSON y armar con IA.
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);

  const errorText = (code: string | undefined) => (code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));

  async function create(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    const res = await fetch('/api/flow/flows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, folderId: folder || null }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res?.ok || !data?.id) {
      setBusy(null);
      setError(errorText(data?.error));
      return;
    }
    router.push(`/app/flow/${data.id}`);
  }

  // ?new=1 (sidebar / ⌘K): crea uno vacío y abre el editor (igual que Robots).
  useEffect(() => {
    if (params.get('new') === '1' && canEdit && !autoCreated.current) {
      autoCreated.current = true;
      // Saca ?new=1 de la URL: volver atrás no debe crear otro.
      const url = new URL(window.location.href);
      url.searchParams.delete('new');
      window.history.replaceState(window.history.state, '', url);
      void create({ name: t('editor.untitled') }, 'new');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, canEdit]);

  // La carpeta elegida queda en la URL (⌘K abre /app/flow?folder=<id>).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (folder) url.searchParams.set('folder', folder);
    else url.searchParams.delete('folder');
    window.history.replaceState(window.history.state, '', url);
  }, [folder]);

  // ⌘K con ?folder= mientras la página ya está abierta.
  useEffect(() => {
    const f = params.get('folder');
    if (f && folders.some((x) => x.id === f)) setFolder(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function toggle(id: string, enabled: boolean) {
    setFlows((list) => list.map((f) => (f.id === id ? { ...f, enabled } : f)));
    const res = await fetch(`/api/flow/flows/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    if (!res?.ok) {
      setFlows((list) => list.map((f) => (f.id === id ? { ...f, enabled: !enabled } : f)));
      setError(t('errors.generic'));
    }
  }

  async function patchFlow(id: string, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/flow/flows/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    return Boolean(res?.ok);
  }

  async function rename() {
    const flow = renaming;
    const name = renameValue.trim();
    if (!flow || !name) return;
    if (name === flow.name) {
      setRenaming(null);
      return;
    }
    setRowBusy(true);
    setRenameError(null);
    const ok = await patchFlow(flow.id, { name });
    setRowBusy(false);
    if (!ok) {
      setRenameError(t('errors.generic'));
      return;
    }
    setFlows((list) => list.map((f) => (f.id === flow.id ? { ...f, name } : f)));
    setRenaming(null);
    // El sidebar y ⌘K leen del servidor.
    router.refresh();
  }

  async function move() {
    const flow = moving;
    if (!flow) return;
    setRowBusy(true);
    const ok = await patchFlow(flow.id, { folderId: moveTo || null });
    setRowBusy(false);
    if (!ok) {
      setError(t('errors.generic'));
      setMoving(null);
      return;
    }
    const prev = flow.folderId;
    setFlows((list) => list.map((f) => (f.id === flow.id ? { ...f, folderId: moveTo || null } : f)));
    setFolders((list) =>
      list.map((d) => ({ ...d, flowCount: d.flowCount + (d.id === moveTo ? 1 : 0) - (d.id === prev ? 1 : 0) })),
    );
    setMoving(null);
  }

  /** Copia apagada con el mismo grafo (los webhooks reciben tokens nuevos). */
  async function duplicate(flow: FlowListItem) {
    setMenu(null);
    setError(null);
    const res = await fetch('/api/flow/flows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: t('list.copyName', { name: flow.name }).slice(0, 120),
        description: flow.description,
        graph: flow.graph,
        folderId: flow.folderId,
      }),
    }).catch(() => null);
    const copy = (await res?.json().catch(() => null)) as FlowListItem | null;
    if (!res?.ok || !copy?.id) {
      setError(t('errors.generic'));
      return;
    }
    setFlows((list) => [{ ...copy, lastRun: null, heldCount: 0 }, ...list]);
    router.refresh();
  }

  function exportFlow(flow: FlowListItem) {
    setMenu(null);
    download(exportFileName(flow.name), JSON.stringify(exportFlowJson(flow), null, 2));
  }

  async function runImport() {
    const parsed = parseFlowImport(importText);
    if (!parsed) {
      setImportError(t('import.invalid'));
      return;
    }
    setBusy('import');
    setImportError(null);
    const res = await fetch('/api/flow/flows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...parsed, imported: true, folderId: folder || null }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string; nodeId?: string } | null;
    setBusy(null);
    if (!res?.ok || !data?.id) {
      setImportError(`${errorText(data?.error)}${data?.nodeId ? ` (${data.nodeId})` : ''}`);
      return;
    }
    router.push(`/app/flow/${data.id}`);
  }

  async function buildWithAi() {
    setBusy('ai');
    setAiError(null);
    const res = await fetch('/api/flow/ai/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: aiPrompt, locale, folderId: folder || null }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res?.ok || !data?.id) {
      setBusy(null);
      setAiError(errorText(data?.error));
      return;
    }
    router.push(`/app/flow/${data.id}`);
  }

  async function remove(flow: FlowListItem) {
    setRowBusy(true);
    const res = await fetch(`/api/flow/flows/${flow.id}`, { method: 'DELETE' }).catch(() => null);
    setRowBusy(false);
    setDeleting(null);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return;
    }
    setFlows((list) => list.filter((f) => f.id !== flow.id));
    if (flow.folderId) setFolders((list) => list.map((d) => (d.id === flow.folderId ? { ...d, flowCount: d.flowCount - 1 } : d)));
    router.refresh();
  }

  async function saveFolder() {
    const edit = folderEdit;
    const name = folderName.trim();
    if (!edit || !name) return;
    setRowBusy(true);
    setFolderError(null);
    const res = await fetch(edit === 'new' ? '/api/flow/folders' : `/api/flow/folders/${edit.id}`, {
      method: edit === 'new' ? 'POST' : 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { folder?: FlowFolderDto; error?: string } | null;
    setRowBusy(false);
    if (!res?.ok || !data?.folder) {
      setFolderError(errorText(data?.error));
      return;
    }
    const saved = data.folder;
    setFolders((list) => [...list.filter((d) => d.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
    if (edit === 'new') setFolder(saved.id);
    setFolderEdit(null);
    router.refresh();
  }

  async function removeFolder(d: FlowFolderDto) {
    setRowBusy(true);
    const res = await fetch(`/api/flow/folders/${d.id}`, { method: 'DELETE' }).catch(() => null);
    setRowBusy(false);
    setFolderDeleting(null);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return;
    }
    setFolders((list) => list.filter((x) => x.id !== d.id));
    setFlows((list) => list.map((f) => (f.folderId === d.id ? { ...f, folderId: null } : f)));
    if (folder === d.id) setFolder('');
    router.refresh();
  }

  /** Retención del historial del workspace (se guarda al elegir; también fija el idioma de los avisos). */
  async function saveRetention(days: number) {
    const prev = retention;
    setRetention(days);
    setSettingsState('saving');
    const res = await fetch('/api/flow/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ retentionDays: days, locale }),
    }).catch(() => null);
    if (!res?.ok) {
      setRetention(prev);
      setSettingsState('error');
      return;
    }
    setSettingsState('saved');
  }

  function triggerLabel(f: FlowListItem): string {
    const trig = triggerNode(f.graph);
    if (!trig) return '';
    const base = t(`nodes.${i18nKey(trig.type)}.title`);
    if (trig.type === 'trigger.event' && f.triggerEvent) return `${base} · ${t(`events.${i18nKey(f.triggerEvent)}`)}`;
    return base;
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return flows.filter((f) => {
      if (folder && f.folderId !== folder) return false;
      if (status === 'on' && !f.enabled) return false;
      if (status === 'off' && f.enabled) return false;
      if (status === 'failing' && f.lastRun?.status !== 'failed') return false;
      if (status === 'held' && !f.heldCount) return false;
      if (status === 'draft' && !f.draft) return false;
      if (!needle) return true;
      return `${f.name} ${f.description} ${triggerLabel(f)}`.toLowerCase().includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flows, q, folder, status]);

  const filtering = Boolean(q.trim()) || status !== 'all';
  const currentFolder = folders.find((d) => d.id === folder) ?? null;

  const createButton = canEdit ? (
    <button
      type="button"
      className="btn btn-primary"
      aria-busy={busy === 'new' || undefined}
      disabled={busy !== null && busy !== 'new'}
      onClick={() => create({ name: t('editor.untitled') }, 'new')}
    >
      {t('list.new')}
    </button>
  ) : null;

  const headerActions = canEdit ? (
    <span className="flow-row-actions">
      <button type="button" className="btn btn-secondary" onClick={() => setAiOpen(true)}>
        {t('ai.build')}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setImportText('');
          setImportError(null);
          setImporting(true);
        }}
      >
        {t('import.button')}
      </button>
      {flows.length > 0 && createButton}
    </span>
  ) : undefined;

  return (
    <div className="ui-page flow-page">
      <PageHeader title={t('title')} description={t('subtitle')} actions={headerActions} />
      {!canEdit && <p className="ui-help">{t('list.adminOnly')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <section className="flow-block" aria-label={t('list.title')}>
        <div className="flow-folders" role="group" aria-label={t('folders.title')}>
          <button type="button" className="ui-tab" aria-pressed={folder === ''} onClick={() => setFolder('')}>
            {t('folders.all')} <span className="ui-tab-count">{flows.length}</span>
          </button>
          {folders.map((d) => (
            <button key={d.id} type="button" className="ui-tab" aria-pressed={folder === d.id} onClick={() => setFolder(d.id)}>
              {d.name} <span className="ui-tab-count">{d.flowCount}</span>
            </button>
          ))}
          {canEdit && (
            <button
              type="button"
              className="btn btn-ghost btn-sm flow-folder-new"
              onClick={() => {
                setFolderName('');
                setFolderError(null);
                setFolderEdit('new');
              }}
            >
              {t('folders.new')}
            </button>
          )}
          {canEdit && currentFolder && (
            <RowMenu
              className="flow-row-menu"
              open={folderMenu}
              label={`${t('folders.actions')}: ${currentFolder.name}`}
              onToggle={setFolderMenu}
              items={[
                {
                  label: t('folders.rename'),
                  onSelect: () => {
                    setFolderMenu(false);
                    setFolderName(currentFolder.name);
                    setFolderError(null);
                    setFolderEdit(currentFolder);
                  },
                },
                {
                  label: t('folders.delete'),
                  danger: true,
                  onSelect: () => {
                    setFolderMenu(false);
                    setFolderDeleting(currentFolder);
                  },
                },
              ]}
            />
          )}
        </div>

        <div className="flow-filters" role="search">
          <input
            type="search"
            className="input flow-filter-q"
            placeholder={t('list.search')}
            aria-label={t('list.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQ('');
            }}
          />
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label={t('list.statusFilter')}>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {t(`list.filters.${s}`)}
              </option>
            ))}
          </select>
          <Link href="/app/flow/runs" className="btn btn-ghost btn-sm">
            {t('history.title')}
          </Link>
        </div>

        <DataTable
          caption={t('list.title')}
          className="flow-table flow-table-flows"
          rows={visible}
          rowKey={(f) => f.id}
          rowHref={(f) => `/app/flow/${f.id}`}
          empty={
            filtering || (folder && flows.length > 0) ? (
              <EmptyState
                title={filtering ? t('list.noMatchTitle') : t('folders.emptyTitle')}
                body={filtering ? t('list.noMatchBody') : t('folders.emptyBody')}
                action={canEdit && !filtering ? createButton : undefined}
              />
            ) : (
              <EmptyState
                product="flow"
                title={t('list.emptyTitle')}
                body={t('list.emptyHint')}
                action={createButton}
                secondary={<a href="#flow-templates">{t('list.emptyTemplates')}</a>}
              />
            )
          }
          columns={[
            {
              key: 'name',
              header: t('list.name'),
              cell: (f) => (
                <span className="flow-name-cell">
                  <span className="flow-ellipsis">{f.name}</span>
                  {f.draft && <span className="badge badge-outline">{t('draft.badge')}</span>}
                </span>
              ),
            },
            { key: 'trigger', header: t('list.trigger'), cell: (f) => <span className="flow-ellipsis">{triggerLabel(f)}</span> },
            {
              key: 'last',
              header: t('list.lastRun'),
              cell: (f) => (
                <span className="flow-last-run">
                  {f.lastRun ? (
                    <>
                      <span className={`badge ${RUN_BADGE[f.lastRun.status] ?? ''}`}>{t(`runs.status.${f.lastRun.status}`)}</span>
                      <span className="flow-muted" suppressHydrationWarning>
                        {format.relativeTime(parseDbUtc(f.lastRun.createdAt), now)}
                      </span>
                    </>
                  ) : (
                    <span className="flow-muted">{t('list.never')}</span>
                  )}
                  {f.heldCount > 0 && <span className="badge badge-warn">{t('held.count', { n: f.heldCount })}</span>}
                </span>
              ),
            },
            {
              key: 'enabled',
              header: t('list.status'),
              width: '120px',
              cell: (f) => (
                <label className="ui-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={f.enabled}
                    disabled={!canEdit}
                    onChange={(e) => void toggle(f.id, e.target.checked)}
                    aria-label={`${f.name}: ${t('editor.enabled')}`}
                  />
                  <span className="flow-muted">{f.enabled ? t('editor.enabled') : t('editor.disabled')}</span>
                </label>
              ),
            },
            ...(canEdit
              ? [
                  {
                    key: 'menu',
                    header: <span className="sr-only">{t('list.actions')}</span>,
                    width: '48px',
                    cell: (f: FlowListItem) => (
                      <RowMenu
                        className="flow-row-menu"
                        open={menu === f.id}
                        label={`${t('list.actions')}: ${f.name}`}
                        onToggle={(open) => setMenu(open ? f.id : null)}
                        items={[
                          {
                            label: t('list.rename'),
                            onSelect: () => {
                              setMenu(null);
                              setRenameValue(f.name);
                              setRenameError(null);
                              setRenaming(f);
                            },
                          },
                          { label: t('list.duplicate'), onSelect: () => void duplicate(f) },
                          {
                            label: t('folders.move'),
                            onSelect: () => {
                              setMenu(null);
                              setMoveTo(f.folderId ?? '');
                              setMoving(f);
                            },
                          },
                          { label: t('import.export'), onSelect: () => exportFlow(f) },
                          {
                            label: t('list.delete'),
                            danger: true,
                            onSelect: () => {
                              setMenu(null);
                              setDeleting(f);
                            },
                          },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </section>

      <QuickModal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={t('list.renameTitle')}
        onSubmit={() => void rename()}
        submitLabel={t('editor.save')}
        cancelLabel={t('editor.cancel')}
        submitDisabled={!renameValue.trim()}
        busy={rowBusy}
        error={renameError}
        width={440}
      >
        <div className="ui-field">
          <label className="label" htmlFor="flow-rename">
            {t('list.name')}
          </label>
          <input
            id="flow-rename"
            className="input"
            value={renameValue}
            maxLength={120}
            onChange={(e) => setRenameValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      </QuickModal>

      <QuickModal
        open={moving !== null}
        onClose={() => setMoving(null)}
        title={t('folders.moveTitle')}
        onSubmit={() => void move()}
        submitLabel={t('folders.move')}
        cancelLabel={t('editor.cancel')}
        busy={rowBusy}
        width={440}
      >
        <div className="ui-field">
          <label className="label" htmlFor="flow-move">
            {t('folders.folder')}
          </label>
          <select id="flow-move" className="select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">{t('folders.none')}</option>
            {folders.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {folders.length === 0 && <p className="ui-help">{t('folders.noneYet')}</p>}
        </div>
      </QuickModal>

      <QuickModal
        open={folderEdit !== null}
        onClose={() => setFolderEdit(null)}
        title={folderEdit === 'new' ? t('folders.newTitle') : t('folders.renameTitle')}
        onSubmit={() => void saveFolder()}
        submitLabel={t('editor.save')}
        cancelLabel={t('editor.cancel')}
        submitDisabled={!folderName.trim()}
        busy={rowBusy}
        error={folderError}
        width={440}
      >
        <div className="ui-field">
          <label className="label" htmlFor="flow-folder-name">
            {t('list.name')}
          </label>
          <input
            id="flow-folder-name"
            className="input"
            value={folderName}
            maxLength={80}
            onChange={(e) => setFolderName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      </QuickModal>

      <QuickModal
        open={importing}
        onClose={() => setImporting(false)}
        title={t('import.title')}
        onSubmit={() => void runImport()}
        submitLabel={t('import.submit')}
        cancelLabel={t('editor.cancel')}
        submitDisabled={!importText.trim()}
        busy={busy === 'import'}
        error={importError}
        width={560}
      >
        <p className="ui-help">{t('import.hint')}</p>
        <div className="ui-field">
          <label className="label" htmlFor="flow-import-file">
            {t('import.file')}
          </label>
          <input
            id="flow-import-file"
            className="input"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 1_000_000) {
                setImportError(t('import.tooLarge'));
                return;
              }
              void file.text().then((text) => {
                setImportText(text);
                setImportError(null);
              });
            }}
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="flow-import-text">
            {t('import.paste')}
          </label>
          <textarea
            id="flow-import-text"
            className="textarea data"
            rows={8}
            spellCheck={false}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
        </div>
      </QuickModal>

      <QuickModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title={t('ai.buildTitle')}
        onSubmit={() => void buildWithAi()}
        submitLabel={busy === 'ai' ? t('ai.building') : t('ai.buildSubmit')}
        cancelLabel={t('editor.cancel')}
        submitDisabled={aiPrompt.trim().length < 10}
        busy={busy === 'ai'}
        error={aiError}
        width={560}
      >
        <div className="ui-field">
          <label className="label" htmlFor="flow-ai-prompt">
            {t('ai.describe')}
          </label>
          <textarea
            id="flow-ai-prompt"
            className="textarea"
            rows={5}
            maxLength={2000}
            placeholder={t('ai.placeholder')}
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
          />
          <p className="ui-help">{t('ai.buildHint')}</p>
        </div>
      </QuickModal>

      <ConfirmDialog
        open={deleting !== null}
        danger
        busy={rowBusy}
        title={t('list.deleteTitle')}
        body={deleting ? t('list.confirmDelete', { name: deleting.name }) : null}
        confirmLabel={t('list.delete')}
        cancelLabel={t('editor.cancel')}
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={folderDeleting !== null}
        danger
        busy={rowBusy}
        title={t('folders.deleteTitle')}
        body={folderDeleting ? t('folders.confirmDelete', { name: folderDeleting.name }) : null}
        confirmLabel={t('folders.delete')}
        cancelLabel={t('editor.cancel')}
        onConfirm={() => folderDeleting && void removeFolder(folderDeleting)}
        onCancel={() => setFolderDeleting(null)}
      />

      <section className="flow-block" id="flow-templates" aria-labelledby="flow-templates-title">
        <div className="flow-block-head">
          <h2 id="flow-templates-title" className="flow-block-title">
            {t('templates.title')}
          </h2>
          <p className="ui-help">{t('templates.subtitle')}</p>
        </div>
        <ul className="flow-templates">
          {FLOW_TEMPLATES.map((tpl) => (
            <li className="flow-template" key={tpl.key}>
              <div className="flow-template-text">
                <h3 className="flow-template-name">{t(`templates.items.${tpl.key}.name`)}</h3>
                <p className="flow-template-desc">{t(`templates.items.${tpl.key}.desc`)}</p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-busy={busy === tpl.key || undefined}
                  disabled={busy !== null && busy !== tpl.key}
                  aria-label={`${t('templates.use')}: ${t(`templates.items.${tpl.key}.name`)}`}
                  onClick={() => create({ name: t(`templates.items.${tpl.key}.name`), template: tpl.key }, tpl.key)}
                >
                  {t('templates.use')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flow-block" aria-labelledby="flow-settings-title">
        <div className="flow-block-head">
          <h2 id="flow-settings-title" className="flow-block-title">
            {t('settings.title')}
          </h2>
          <p className="ui-help">{t('settings.retentionHint')}</p>
        </div>
        <div className="ui-field flow-retention">
          <label className="label" htmlFor="flow-retention">
            {t('settings.retention')}
          </label>
          <select
            id="flow-retention"
            className="select"
            value={retention}
            disabled={!canEdit || settingsState === 'saving'}
            onChange={(e) => void saveRetention(Number(e.target.value))}
          >
            {RETENTION_DAYS.map((d) => (
              <option key={d} value={d}>
                {t('settings.days', { n: d })}
              </option>
            ))}
          </select>
          <p className="ui-help" role="status">
            {settingsState === 'saved' ? t('settings.saved') : settingsState === 'error' ? t('errors.generic') : ''}
          </p>
        </div>
      </section>
    </div>
  );
}
