'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import CrmIcon from './CrmIcon';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { currentColumns } from './EditColumns';
import {
  SAVED_VIEW_PARAM,
  addTab,
  closeTab,
  moveTab,
  togglePin,
  type TabPref,
  type ViewEntity,
  type ViewVisibility,
} from '@/lib/crm-views-shared';

export interface ViewTabItem {
  key: string;
  label: string;
  pinned: boolean;
  /** Vista guardada (no una por defecto). */
  saved: boolean;
  canEdit: boolean;
  visibility?: ViewVisibility;
  teamId?: string | null;
  /** Filtra por campos que la persona tiene ocultos: esos filtros no se le aplican. */
  partial?: boolean;
}

interface ViewTabsProps {
  entity: ViewEntity;
  pathname: string;
  /** Params que no son de la vista y se conservan al cambiar de pestaña (pipeline, board/tabla). */
  baseQuery?: Record<string, string>;
  /** Pestañas abiertas, en orden. La activa puede no estar (abierta por link): se agrega. */
  tabs: ViewTabItem[];
  activeKey: string;
  /** La que se abre sin `sv` (la primera pestaña): su link va sin `sv`. */
  defaultKey: string;
  /** La activa, si no está entre las pestañas. */
  activeExtra?: ViewTabItem | null;
  /** El listado difiere de la vista activa. */
  modified: boolean;
  /** Estado actual del listado (lo que se guarda). */
  state: Record<string, string>;
  /** Equipos con los que la persona puede compartir. */
  teams: Array<{ id: string; name: string }>;
}

/** Cuántas pestañas entran antes de "Más". */
function useTabLimit(): number {
  const [limit, setLimit] = useState(6);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const set = () => setLimit(mq.matches ? 2 : 6);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);
  return limit;
}

/** Cierra un menú con un clic afuera o con Esc (y devuelve el foco al botón). */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref, btnRef };
}

/**
 * Pestañas de vistas arriba del listado, como en HubSpot: las por defecto
 * (Todos, Míos, Sin asignar o Abiertos) y las guardadas. Se fijan, se
 * reordenan (arrastrando o desde el menú) y se cierran; las que no entran van
 * a "Más". Si el listado cambió, aparecen Restablecer, Guardar y Guardar como.
 */
export default function ViewTabs({ entity, pathname, baseQuery = {}, tabs, activeKey, defaultKey, activeExtra, modified, state, teams }: ViewTabsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const limit = useTabLimit();
  const [order, setOrder] = useState<ViewTabItem[]>(tabs);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { mode: 'create' | 'edit'; view?: ViewTabItem }>(null);
  const [confirmDelete, setConfirmDelete] = useState<ViewTabItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const tabMenu = useMenu();
  const moreMenu = useMenu();
  const addMenu = useMenu();

  useEffect(() => setOrder(tabs), [tabs]);

  // Una vista abierta por link (o desde "Todas las vistas") queda como pestaña.
  const extraKey = activeExtra?.key;
  useEffect(() => {
    if (!extraKey) return;
    void persist(addTab(prefsOf(tabs), extraKey), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraKey]);

  const all = activeExtra && !order.some((x) => x.key === activeExtra.key) ? [...order, activeExtra] : order;
  const active = all.find((x) => x.key === activeKey) ?? all[0];

  function prefsOf(items: ViewTabItem[]): TabPref[] {
    return items.map((x) => (x.pinned ? { key: x.key, pinned: true } : { key: x.key }));
  }

  function href(key: string): string {
    const q = new URLSearchParams(baseQuery);
    if (key !== defaultKey) q.set(SAVED_VIEW_PARAM, key);
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  async function persist(next: TabPref[], refresh = true) {
    const byKey = new Map(all.map((x) => [x.key, x]));
    setOrder(next.map((p) => ({ ...(byKey.get(p.key) as ViewTabItem), pinned: !!p.pinned })).filter((x) => x.key));
    const res = await fetch('/api/crm/views/tabs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity, tabs: next }),
    }).catch(() => null);
    if (!res?.ok) setNotice(t('views.errors.generic'));
    if (refresh) router.refresh();
  }

  function stateToSave(): Record<string, string> {
    const cols = currentColumns(entity);
    const out = { ...state };
    if (!out.cols && cols?.cols) out.cols = cols.cols;
    if (!out.freeze && cols?.freeze) out.freeze = '1';
    if (!out.widths && cols?.widths) out.widths = cols.widths;
    return out;
  }

  async function saveChanges() {
    if (!active?.saved) return;
    setBusy(true);
    const res = await fetch(`/api/crm/views/${active.key}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: stateToSave() }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setNotice(errorText(res?.status));
      return;
    }
    router.push(href(active.key));
    router.refresh();
  }

  function errorText(status?: number): string {
    if (status === 403) return t('views.errors.forbidden');
    if (status === 404) return t('views.errors.notFound');
    return t('views.errors.generic');
  }

  async function deleteView(view: ViewTabItem) {
    setBusy(true);
    const res = await fetch(`/api/crm/views/${view.key}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setConfirmDelete(null);
    if (!res?.ok) {
      setNotice(errorText(res?.status));
      return;
    }
    if (view.key === activeKey) router.push(href(view.key === defaultKey ? 'all' : defaultKey));
    router.refresh();
  }

  // Lo que entra en la fila: las primeras `limit`, con la activa siempre visible.
  let shown = all.slice(0, limit);
  if (active && !shown.some((x) => x.key === active.key)) shown = [...all.slice(0, Math.max(limit - 1, 1)), active];
  const hidden = all.filter((x) => !shown.some((s) => s.key === x.key));
  const index = active ? all.findIndex((x) => x.key === active.key) : -1;
  const pinnedCount = all.filter((x) => x.pinned).length;
  const canMoveLeft = active && index > (active.pinned ? 0 : pinnedCount);
  const canMoveRight = active && index < (active.pinned ? pinnedCount - 1 : all.length - 1);

  return (
    <div className="views-bar" data-testid="view-tabs">
      <div className="views-tabs" role="tablist" aria-label={t('views.tabsLabel')}>
        {shown.map((tab) => {
          const isActive = tab.key === active?.key;
          return (
            <div
              key={tab.key}
              className={`view-tab${isActive ? ' active' : ''}${dragKey === tab.key ? ' is-dragging' : ''}`}
              draggable
              onDragStart={() => setDragKey(tab.key)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => {
                if (dragKey && dragKey !== tab.key) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!dragKey || dragKey === tab.key) return;
                void persist(moveTab(prefsOf(all), dragKey, all.findIndex((x) => x.key === tab.key)));
                setDragKey(null);
              }}
              data-testid={`view-tab-${tab.saved ? 'saved' : tab.key}`}
              data-view-key={tab.key}
            >
              <Link
                href={href(tab.key)}
                role="tab"
                aria-selected={isActive}
                className="view-tab-link"
                title={tab.label}
              >
                {tab.pinned && <CrmIcon name="pin" size={12} />}
                <span className="view-tab-name">{tab.label}</span>
                {isActive && modified && <span className="view-tab-dot" aria-label={t('views.unsaved')} />}
              </Link>
              {isActive && (
                <div className="record-more view-tab-more" ref={tabMenu.ref}>
                  <button
                    ref={tabMenu.btnRef}
                    type="button"
                    className="view-tab-menu-btn"
                    aria-haspopup="menu"
                    aria-expanded={tabMenu.open}
                    aria-label={t('views.tabOptions', { name: tab.label })}
                    onClick={() => tabMenu.setOpen(!tabMenu.open)}
                    data-testid="view-tab-menu-btn"
                  >
                    <CrmIcon name="chevronDown" size={12} />
                  </button>
                  {tabMenu.open && (
                    <div role="menu" className="record-more-menu view-menu" data-testid="view-tab-menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="record-more-item"
                        onClick={() => {
                          tabMenu.setOpen(false);
                          void persist(togglePin(prefsOf(all), tab.key));
                        }}
                        data-testid="view-pin"
                      >
                        {tab.pinned ? t('views.unpin') : t('views.pin')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="record-more-item"
                        disabled={!canMoveLeft}
                        onClick={() => {
                          tabMenu.setOpen(false);
                          void persist(moveTab(prefsOf(all), tab.key, index - 1));
                        }}
                        data-testid="view-move-left"
                      >
                        {t('views.moveLeft')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="record-more-item"
                        disabled={!canMoveRight}
                        onClick={() => {
                          tabMenu.setOpen(false);
                          void persist(moveTab(prefsOf(all), tab.key, index + 1));
                        }}
                        data-testid="view-move-right"
                      >
                        {t('views.moveRight')}
                      </button>
                      {tab.saved && tab.canEdit && (
                        <button
                          type="button"
                          role="menuitem"
                          className="record-more-item has-rule"
                          onClick={() => {
                            tabMenu.setOpen(false);
                            setDialog({ mode: 'edit', view: tab });
                          }}
                          data-testid="view-edit"
                        >
                          {t('views.edit')}
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        className={`record-more-item${tab.saved && tab.canEdit ? '' : ' has-rule'}`}
                        onClick={() => {
                          tabMenu.setOpen(false);
                          setDialog({ mode: 'create' });
                        }}
                        data-testid="view-clone"
                      >
                        {t('views.saveAs')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="record-more-item"
                        disabled={tab.pinned || all.length <= 1}
                        onClick={() => {
                          tabMenu.setOpen(false);
                          const next = closeTab(prefsOf(all), tab.key);
                          void persist(next, false).then(() => router.push(href(next[0]?.key ?? 'all')));
                        }}
                        data-testid="view-close"
                      >
                        {t('views.close')}
                      </button>
                      {tab.saved && tab.canEdit && (
                        <button
                          type="button"
                          role="menuitem"
                          className="record-more-item is-danger has-rule"
                          onClick={() => {
                            tabMenu.setOpen(false);
                            setConfirmDelete(tab);
                          }}
                          data-testid="view-delete"
                        >
                          {t('views.delete')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {hidden.length > 0 && (
          <div className="record-more" ref={moreMenu.ref}>
            <button
              ref={moreMenu.btnRef}
              type="button"
              className="view-tab view-tab-btn"
              aria-haspopup="menu"
              aria-expanded={moreMenu.open}
              onClick={() => moreMenu.setOpen(!moreMenu.open)}
              data-testid="view-more-btn"
            >
              {t('views.more', { count: hidden.length })}
              <CrmIcon name="chevronDown" size={12} />
            </button>
            {moreMenu.open && (
              <div role="menu" className="record-more-menu view-menu" data-testid="view-more-menu">
                {hidden.map((x) => (
                  <Link key={x.key} role="menuitem" className="record-more-item" href={href(x.key)} onClick={() => moreMenu.setOpen(false)}>
                    {x.pinned && <CrmIcon name="pin" size={12} />}
                    <span className="view-tab-name">{x.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="record-more" ref={addMenu.ref}>
          <button
            ref={addMenu.btnRef}
            type="button"
            className="view-tab view-tab-btn view-tab-add"
            aria-haspopup="menu"
            aria-expanded={addMenu.open}
            aria-label={t('views.addView')}
            onClick={() => addMenu.setOpen(!addMenu.open)}
            data-testid="view-add-btn"
          >
            <CrmIcon name="plus" size={14} />
            <span className="view-tab-add-label">{t('views.addView')}</span>
          </button>
          {addMenu.open && (
            <div role="menu" className="record-more-menu view-menu" data-testid="view-add-menu">
              <button
                type="button"
                role="menuitem"
                className="record-more-item"
                onClick={() => {
                  addMenu.setOpen(false);
                  setDialog({ mode: 'create' });
                }}
                data-testid="view-create"
              >
                {t('views.create')}
              </button>
              <Link role="menuitem" className="record-more-item" href={`/app/crm/views?entity=${entity}`} data-testid="view-all-views">
                {t('views.allViews')}
              </Link>
            </div>
          )}
        </div>
      </div>

      {modified && (
        <div className="views-actions" data-testid="view-modified">
          <span className="muted views-modified">{t('views.unsaved')}</span>
          <Link href={href(active?.key ?? 'all')} className="btn btn-sm btn-ghost" data-testid="view-reset">
            {t('views.reset')}
          </Link>
          {/* Guardar sobre una vista con filtros que no se le aplican los borraría: solo "Guardar como". */}
          {active?.saved && active.canEdit && !active.partial && (
            <button type="button" className="btn btn-sm" onClick={saveChanges} disabled={busy} data-testid="view-save">
              {t('views.save')}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog({ mode: 'create' })} data-testid="view-save-as">
            {t('views.saveAs')}
          </button>
        </div>
      )}

      {active?.partial && (
        <p className="muted views-notice" data-testid="view-partial">
          {t('views.partialFilters')}
        </p>
      )}

      {notice && (
        <p className="muted views-notice" role="status">
          {notice}
        </p>
      )}

      <SaveViewDialog
        open={!!dialog}
        mode={dialog?.mode ?? 'create'}
        view={dialog?.view}
        teams={teams}
        onClose={() => setDialog(null)}
        onSubmit={async ({ name, visibility, teamId }) => {
          const editing = dialog?.mode === 'edit' && dialog.view;
          const res = await fetch(editing ? `/api/crm/views/${dialog.view!.key}` : '/api/crm/views', {
            method: editing ? 'PATCH' : 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              editing
                ? { name, visibility, teamId: visibility === 'team' ? teamId : null }
                : { entity, name, visibility, teamId: visibility === 'team' ? teamId : null, query: stateToSave() },
            ),
          }).catch(() => null);
          if (!res?.ok) return errorText(res?.status);
          const view = (await res.json().catch(() => null)) as { id?: string } | null;
          setDialog(null);
          if (!editing && view?.id) router.push(href(view.id));
          router.refresh();
          return null;
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('views.deleteTitle', { name: confirmDelete?.label ?? '' })}
        body={confirmDelete?.visibility && confirmDelete.visibility !== 'private' ? t('views.deleteShared') : t('views.deleteBody')}
        confirmLabel={t('views.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => confirmDelete && deleteView(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function SaveViewDialog({
  open,
  mode,
  view,
  teams,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  view?: ViewTabItem;
  teams: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSubmit: (v: { name: string; visibility: ViewVisibility; teamId: string | null }) => Promise<string | null>;
}) {
  const t = useTranslations('crm');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<ViewVisibility>('private');
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setName(mode === 'edit' ? view?.label ?? '' : '');
      setVisibility(mode === 'edit' ? view?.visibility ?? 'private' : 'private');
      setTeamId((mode === 'edit' ? view?.teamId : null) ?? teams[0]?.id ?? '');
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, mode, view, teams]);

  return (
    <dialog
      ref={ref}
      className="ui-modal save-view-dialog"
      aria-labelledby={titleId}
      data-testid="save-view-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            const err = await onSubmit({ name: name.trim(), visibility, teamId: visibility === 'team' ? teamId || null : null });
            setBusy(false);
            setError(err);
          }}
        >
          <div className="ui-modal-head">
            <h2 className="ui-modal-title" id={titleId}>
              {mode === 'edit' ? t('views.editTitle') : t('views.createTitle')}
            </h2>
          </div>
          <div className="ui-modal-body save-view-body">
            <label className="ui-field">
              <span className="label">{t('views.name')}</span>
              <input
                className="input"
                autoFocus
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                data-testid="save-view-name"
              />
            </label>
            <fieldset className="ui-field save-view-visibility">
              <legend className="label">{t('views.visibility.label')}</legend>
              <label className="column-toggle-row">
                <input type="radio" name="visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} data-testid="save-view-private" />
                <span>
                  {t('views.visibility.private')}
                  <span className="muted save-view-hint">{t('views.visibility.privateHint')}</span>
                </span>
              </label>
              <label className="column-toggle-row">
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === 'team'}
                  disabled={teams.length === 0}
                  onChange={() => setVisibility('team')}
                  data-testid="save-view-team"
                />
                <span>
                  {t('views.visibility.team')}
                  <span className="muted save-view-hint">
                    {teams.length === 0 ? t('views.visibility.noTeam') : t('views.visibility.teamHint')}
                  </span>
                </span>
              </label>
              {visibility === 'team' && teams.length > 1 && (
                <select className="filter-select save-view-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label={t('views.visibility.chooseTeam')}>
                  {teams.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              )}
              <label className="column-toggle-row">
                <input type="radio" name="visibility" checked={visibility === 'everyone'} onChange={() => setVisibility('everyone')} data-testid="save-view-everyone" />
                <span>
                  {t('views.visibility.everyone')}
                  <span className="muted save-view-hint">{t('views.visibility.everyoneHint')}</span>
                </span>
              </label>
            </fieldset>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !name.trim()} data-testid="save-view-submit">
              {t('common.save')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
