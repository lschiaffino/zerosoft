'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useDismiss } from '@/components/groups/wa/useDismiss';
import BulkEditControls, { type BulkEditField } from './BulkEditControls';
import TagBulkControls from './TagBulkControls';
import { OWNER_UNASSIGNED } from '@/lib/crm-filter-model';

type Entity = 'contact' | 'company';
type Panel = 'assign' | 'edit' | 'list' | 'tags' | 'sequence' | 'delete';

interface Option {
  value: string;
  label: string;
}

/**
 * Barra de acciones masivas de contactos y empresas, con las de HubSpot a la
 * vista: Asignar, Editar, Agregar a lista (contactos), Tags, Inscribir en
 * secuencia (contactos), Exportar y Eliminar. Cada una abre su panel encima de
 * la barra (cierra con Esc o un clic afuera). El server vuelve a chequear todo:
 * solo los registros que la persona ve, permisos por campo y borrar solo admins.
 */
export default function BulkActionsBar({
  entity,
  ids,
  owners,
  bulkFields,
  allTags,
  lists = [],
  sequences = [],
  canDelete,
  canExport,
  onClear,
  onNotice,
}: {
  entity: Entity;
  ids: string[];
  owners: Option[];
  bulkFields: BulkEditField[];
  allTags: Array<{ id: string; name: string }>;
  /** Listas estáticas de contactos (Agregar a lista). */
  lists?: Array<{ id: string; name: string }>;
  sequences?: Array<{ id: string; name: string }>;
  canDelete: boolean;
  canExport: boolean;
  onClear: () => void;
  /** Mensaje para debajo de la tabla al terminar (la selección se limpia). */
  onNotice: (notice: string) => void;
}) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listId, setListId] = useState('');
  const [sequenceId, setSequenceId] = useState('');
  const bar = useRef<HTMLDivElement>(null);
  useDismiss(panel !== null, (reason) => {
    const open = panel;
    setPanel(null);
    // Esc devuelve el foco al botón de la acción.
    if (reason === 'escape' && open) bar.current?.querySelector<HTMLElement>(`[data-panel="${open}"]`)?.focus();
  }, [bar]);
  // Al abrir un panel, el foco va a su primer control.
  useEffect(() => {
    if (!panel) return;
    bar.current?.querySelector<HTMLElement>('.bk-pop button:not([disabled]), .bk-pop select, .bk-pop input')?.focus();
  }, [panel]);

  const plural = entity === 'contact' ? 'contacts' : 'companies';
  const endpoint = `/api/crm/${plural}/bulk`;
  const canEditOwner = bulkFields.some((f) => f.key === 'ownerId');

  function toggle(p: Panel) {
    setError(null);
    setPanel((cur) => (cur === p ? null : p));
  }

  function errorText(code: string | undefined): string {
    return code && t.has(`errors.${code}`) ? t(`errors.${code}` as 'errors.generic') : t('errors.generic');
  }

  async function post(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res?.ok) {
      setError(errorText(typeof data?.error === 'string' ? data.error : undefined));
      return null;
    }
    return data ?? {};
  }

  function finish(notice: string) {
    setPanel(null);
    onNotice(notice);
    router.refresh();
  }

  async function assign(owner: string) {
    const data = await post(endpoint, { action: 'set_property', ids, field: 'ownerId', value: owner === OWNER_UNASSIGNED ? null : owner });
    if (data) finish(t('bulkEdit.done', { count: Number(data.count ?? 0) }));
  }

  async function addToList() {
    if (!listId) return;
    const data = await post(`/api/crm/lists/${listId}/members`, { contactIds: ids });
    if (data) finish(t('bulkBar.addedToList', { count: Number(data.count ?? 0) }));
  }

  async function enroll() {
    if (!sequenceId) return;
    const data = await post(`/api/crm/sequences/${sequenceId}/enroll`, { contactIds: ids });
    if (!data) return;
    const enrolled = Array.isArray(data.enrolled) ? data.enrolled.length : 0;
    const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
    finish(`${t('sequences.enrolledOk', { count: enrolled })}${skipped ? ` ${t('sequences.enrolledSkipped', { count: skipped })}` : ''}`);
  }

  async function remove() {
    const data = await post(endpoint, { action: 'delete', ids });
    if (data) finish(t('bulkBar.deleted', { count: Number(data.count ?? 0) }));
  }

  const exportHref = `/api/crm/export?${new URLSearchParams({ entity: plural, format: 'csv', ids: ids.join(',') }).toString()}`;

  function action(p: Panel, label: string, content: ReactNode, opts: { danger?: boolean; testId: string }) {
    return (
      <span className="bk-action">
        <button
          type="button"
          className={`bulk-btn${opts.danger ? ' danger' : ''}${panel === p ? ' is-open' : ''}`}
          aria-expanded={panel === p}
          aria-haspopup="dialog"
          disabled={busy}
          onClick={() => toggle(p)}
          data-panel={p}
          data-testid={opts.testId}
        >
          {label}
        </button>
        {panel === p && (
          <div className="bk-pop" role="dialog" aria-label={label}>
            {content}
            {error && (
              <p className="bulk-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </span>
    );
  }

  return (
    <div className="bulk-bar hs-bulk" role="toolbar" aria-label={t('bulkBar.label')} ref={bar} data-testid="crm-bulk-bar">
      <span className="bulk-count">{t('contacts.bulk.selected', { count: ids.length })}</span>
      {canEditOwner &&
        action(
          'assign',
          t('bulkBar.assign'),
          <div className="bk-options" role="listbox" aria-label={t('bulkBar.assign')}>
            {[{ value: OWNER_UNASSIGNED, label: t('listBar.noOwner') }, ...owners].map((o) => (
              <button key={o.value} type="button" role="option" aria-selected={false} className="bk-option" disabled={busy} onClick={() => assign(o.value)}>
                {o.label}
              </button>
            ))}
          </div>,
          { testId: 'bulk-assign' },
        )}
      {bulkFields.length > 0 &&
        action(
          'edit',
          t('bulkBar.edit'),
          <div className="bk-form">
            <BulkEditControls endpoint={endpoint} ids={ids} fields={bulkFields} disabled={busy} onDone={(notice) => finish(notice)} />
          </div>,
          { testId: 'bulk-edit' },
        )}
      {entity === 'contact' &&
        lists.length > 0 &&
        action(
          'list',
          t('bulkBar.addToList'),
          <div className="bk-form">
            <select className="filter-select" value={listId} onChange={(e) => setListId(e.target.value)} aria-label={t('bulkBar.list')} disabled={busy}>
              <option value="">{t('bulkBar.pickList')}</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button type="button" className="bulk-btn" disabled={busy || !listId} onClick={addToList}>
              {t('bulkBar.add')}
            </button>
          </div>,
          { testId: 'bulk-list' },
        )}
      {allTags.length > 0 &&
        action(
          'tags',
          t('tags.column'),
          <div className="bk-form">
            <TagBulkControls
              entity={entity}
              ids={ids}
              tags={allTags}
              disabled={busy}
              onDone={() => {
                setPanel(null);
                onClear();
              }}
            />
          </div>,
          { testId: 'bulk-tags' },
        )}
      {entity === 'contact' &&
        sequences.length > 0 &&
        action(
          'sequence',
          t('contacts.bulk.enroll'),
          <div className="bk-form">
            <select className="filter-select" value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} aria-label={t('contacts.bulk.enroll')} disabled={busy}>
              <option value="">{t('contacts.bulk.enroll')}</option>
              {sequences.map((sq) => (
                <option key={sq.id} value={sq.id}>
                  {sq.name}
                </option>
              ))}
            </select>
            <button type="button" className="bulk-btn" disabled={busy || !sequenceId} onClick={enroll}>
              {t('sequences.enrollCta')}
            </button>
          </div>,
          { testId: 'bulk-sequence' },
        )}
      {canExport && (
        <a className="bulk-btn" href={exportHref} download data-testid="bulk-export">
          {t('listBar.export')}
        </a>
      )}
      {canDelete &&
        action(
          'delete',
          t('contacts.bulk.delete'),
          <div className="bk-form bk-confirm">
            <span>{t(entity === 'contact' ? 'contacts.bulk.confirmDelete' : 'companies.bulk.confirmDelete', { count: ids.length })}</span>
            <button type="button" className="bulk-btn danger" disabled={busy} onClick={remove} data-testid="bulk-delete-confirm">
              {t('contacts.bulk.delete')}
            </button>
            <button type="button" className="bulk-btn" disabled={busy} onClick={() => setPanel(null)}>
              {t('common.cancel')}
            </button>
          </div>,
          { danger: true, testId: 'bulk-delete' },
        )}
      <button type="button" className="bulk-btn bk-clear" disabled={busy} onClick={onClear} aria-label={t('bulkBar.clear')} title={t('bulkBar.clear')}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
