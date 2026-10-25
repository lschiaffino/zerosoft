'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useLocale, useNow, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';
import RowMenu from '@/components/notes/RowMenu';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import type { FlowListItem, FlowSettingsDto } from '@/lib/flow';
import { FLOW_TEMPLATES, RETENTION_DAYS, triggerNode } from '@/lib/flow-schema';
import { i18nKey, RUN_BADGE } from './flow-ui';
import { parseDbUtc } from '@/lib/utils';

interface Props {
  flows: FlowListItem[];
  canEdit: boolean;
  settings: FlowSettingsDto;
}

/** Lista de flows + plantillas (/app/flow). */
export default function FlowsHome({ flows: initial, canEdit, settings: initialSettings }: Props) {
  const t = useTranslations('flow');
  const locale = useLocale();
  const [retention, setRetention] = useState(initialSettings.retentionDays);
  const [settingsState, setSettingsState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const router = useRouter();
  const [flows, setFlows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const autoCreated = useRef(false);
  // Menú "…" por fila: renombrar (modal), duplicar y eliminar (con confirmación).
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<FlowListItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FlowListItem | null>(null);
  const [rowBusy, setRowBusy] = useState(false);

  async function create(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    const res = await fetch('/api/flow/flows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res?.ok || !data?.id) {
      setBusy(null);
      setError(t.has(`errors.${data?.error}`) ? t(`errors.${data?.error}`) : t('errors.generic'));
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
    const res = await fetch(`/api/flow/flows/${flow.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setRowBusy(false);
    if (!res?.ok) {
      setRenameError(t('errors.generic'));
      return;
    }
    setFlows((list) => list.map((f) => (f.id === flow.id ? { ...f, name } : f)));
    setRenaming(null);
    // El sidebar y ⌘K leen del servidor.
    router.refresh();
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
      }),
    }).catch(() => null);
    const copy = (await res?.json().catch(() => null)) as FlowListItem | null;
    if (!res?.ok || !copy?.id) {
      setError(t('errors.generic'));
      return;
    }
    setFlows((list) => [{ ...copy, lastRun: null }, ...list]);
    router.refresh();
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

  return (
    <div className="ui-page flow-page">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={flows.length > 0 ? createButton : undefined}
      />
      {!canEdit && <p className="ui-help">{t('list.adminOnly')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <section className="flow-block" aria-label={t('list.title')}>
        <DataTable
          caption={t('list.title')}
          className="flow-table flow-table-flows"
          rows={flows}
          rowKey={(f) => f.id}
          rowHref={(f) => `/app/flow/${f.id}`}
          empty={
            <EmptyState
              product="flow"
              title={t('list.emptyTitle')}
              body={t('list.emptyHint')}
              action={createButton}
              secondary={<a href="#flow-templates">{t('list.emptyTemplates')}</a>}
            />
          }
          columns={[
            {
              key: 'name',
              header: t('list.name'),
              cell: (f) => (
                <span className="flow-name-cell">
                  <span className="flow-ellipsis">{f.name}</span>
                </span>
              ),
            },
            { key: 'trigger', header: t('list.trigger'), cell: (f) => <span className="flow-ellipsis">{triggerLabel(f)}</span> },
            {
              key: 'last',
              header: t('list.lastRun'),
              cell: (f) =>
                f.lastRun ? (
                  <span className="flow-last-run">
                    <span className={`badge ${RUN_BADGE[f.lastRun.status] ?? ''}`}>{t(`runs.status.${f.lastRun.status}`)}</span>
                    <span className="flow-muted" suppressHydrationWarning>
                      {format.relativeTime(parseDbUtc(f.lastRun.createdAt), now)}
                    </span>
                  </span>
                ) : (
                  <span className="flow-muted">{t('list.never')}</span>
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
