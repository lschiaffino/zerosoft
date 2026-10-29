'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { DESIGN_PRESETS, MAX_SIDE, MIN_SIDE } from '@/lib/design-model';
import type { DesignFolder, DesignSummary, DesignView } from '@/lib/design';
import { DESIGN_CHANGED, G, Glyph, Modal, notifyDesignChanged, Popover } from './ui';

const TABS: DesignView[] = ['recent', 'mine', 'shared', 'starred', 'trash'];

function relTime(iso: string, locale: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diff < 60) return rtf.format(-Math.round(diff), 'second');
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString(locale);
}

export default function DesignHome({
  initialDesigns,
  initialFolders,
  view,
  folderId,
  startNew,
  initialQ,
}: {
  initialDesigns: DesignSummary[];
  initialFolders: DesignFolder[];
  view: DesignView;
  folderId: string | null;
  startNew: boolean;
  initialQ: string;
}) {
  const t = useTranslations('design.home');
  const tp = useTranslations('design.presets');
  const locale = useLocale();
  const router = useRouter();
  const [designs, setDesigns] = useState(initialDesigns);
  const [folders, setFolders] = useState(initialFolders);
  const [q, setQ] = useState(initialQ);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | null
    | { kind: 'create' }
    | { kind: 'custom' }
    | { kind: 'rename'; d: DesignSummary }
    | { kind: 'move'; d: DesignSummary }
    | { kind: 'purge'; d: DesignSummary }
    | { kind: 'newFolder' }
    | { kind: 'renameFolder'; f: DesignFolder }
    | { kind: 'deleteFolder'; f: DesignFolder }
  >(startNew ? { kind: 'create' } : null);
  const [toast, setToast] = useState<string | null>(null);
  const folder = folderId ? folders.find((f) => f.id === folderId) : null;

  const reload = useCallback(
    async (query = q) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ view, q: query });
        if (folderId) params.set('folder', folderId);
        const r = await fetch(`/api/design/designs?${params}`);
        if (!r.ok) throw new Error('load');
        const d = (await r.json()) as { designs: DesignSummary[]; folders: DesignFolder[] };
        setDesigns(d.designs);
        setFolders(d.folders);
      } catch {
        setError(t('loadError'));
      } finally {
        setLoading(false);
      }
    },
    [q, view, folderId, t],
  );

  // Cambios desde otro lado (el editor, el sidebar): la lista se pone al día.
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener(DESIGN_CHANGED, on);
    return () => window.removeEventListener(DESIGN_CHANGED, on);
  }, [reload]);

  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) {
      firstSearch.current = false;
      return;
    }
    const id = window.setTimeout(() => void reload(q), 250);
    return () => window.clearTimeout(id);
    // Solo cuando cambia la búsqueda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((c) => (c === msg ? null : c)), 3000);
  };

  const create = async (body: Record<string, unknown>, key: string) => {
    setCreating(key);
    setError(null);
    try {
      const r = await fetch('/api/design/designs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, locale, untitled: t('untitled'), folderId }),
      });
      if (!r.ok) throw new Error('create');
      const d = (await r.json()) as { design: { id: string } };
      notifyDesignChanged();
      router.push(`/app/design/${d.design.id}`);
    } catch {
      setError(t('createError'));
      setCreating(null);
    }
  };

  const act = async (url: string, init: RequestInit, ok?: string) => {
    const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init }).catch(() => null);
    if (!r?.ok) {
      flash(t('actionError'));
      return false;
    }
    if (ok) flash(ok);
    notifyDesignChanged();
    await reload();
    return true;
  };

  const tabHref = (v: DesignView) => (v === 'recent' ? '/app/design' : `/app/design?view=${v}`);

  return (
    <div className="app-page ui-page dz-home" data-testid="design-home">
      <PageHeader
        title={folder ? folder.name : t('title')}
        description={folder ? t('folderLead') : t('lead')}
        back={folder ? { href: '/app/design', label: t('title') } : undefined}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })} data-testid="design-create">
            {t('create')}
          </button>
        }
      />

      {!folder && view !== 'trash' && (
        <section className="dz-presets" aria-label={t('createTitle')}>
          {DESIGN_PRESETS.map((p) => (
            <button key={p.key} type="button" className="dz-preset" onClick={() => void create({ width: p.w, height: p.h, name: tp(`${p.key}.name`) }, p.key)} disabled={!!creating} data-testid={`design-preset-${p.key}`}>
              <span className="dz-preset-shape" aria-hidden="true">
                <span style={{ aspectRatio: `${p.w} / ${p.h}` }} />
              </span>
              <span className="dz-preset-name">{tp(`${p.key}.name`)}</span>
              <span className="dz-preset-size data">
                {p.w} × {p.h} px
              </span>
            </button>
          ))}
          <button type="button" className="dz-preset" onClick={() => setDialog({ kind: 'custom' })} disabled={!!creating}>
            <span className="dz-preset-shape is-custom" aria-hidden="true">
              <Glyph d={G.plus} size={20} />
            </span>
            <span className="dz-preset-name">{tp('custom.name')}</span>
            <span className="dz-preset-size data">{t('anySize')}</span>
          </button>
          <Link href="/app/design/templates" className="dz-preset dz-preset-link">
            <span className="dz-preset-shape is-custom" aria-hidden="true">
              <Glyph d={G.template} size={20} />
            </span>
            <span className="dz-preset-name">{t('fromTemplate')}</span>
            <span className="dz-preset-size data">{t('templatesCount')}</span>
          </Link>
        </section>
      )}

      <div className="dz-home-bar">
        {!folder && (
          <nav className="dz-tabs" aria-label={t('views')}>
            {TABS.map((v) => (
              <Link key={v} href={tabHref(v)} className={`dz-tab${view === v ? ' is-active' : ''}`} aria-current={view === v ? 'page' : undefined} data-testid={`design-view-${v}`}>
                {t(`views.${v}`)}
              </Link>
            ))}
          </nav>
        )}
        <input className="input dz-search" type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="design-search" />
      </div>

      {!folder && view !== 'trash' && (
        <div className="dz-folders" aria-label={t('folders')}>
          {folders.map((f) => (
            <Link key={f.id} href={`/app/design?folder=${encodeURIComponent(f.id)}`} className="dz-folder" data-testid="design-folder">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M3 6h6l2 2h10v11H3z" />
              </svg>
              <span>{f.name}</span>
              <span className="data muted">{f.count}</span>
            </Link>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'newFolder' })} data-testid="design-new-folder">
            <Glyph d={G.plus} /> {t('newFolder')}
          </button>
        </div>
      )}

      {folder && (
        <div className="dz-folder-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'renameFolder', f: folder })}>
            {t('renameFolder')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'deleteFolder', f: folder })}>
            {t('deleteFolder')}
          </button>
        </div>
      )}

      {error && (
        <div className="ui-error dz-home-error" role="alert">
          <span>{error}</span>{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reload()}>
            {t('retry')}
          </button>
        </div>
      )}

      {loading && !designs.length ? (
        <div className="dz-cards" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="ui-skeleton dz-card-skeleton" />
          ))}
        </div>
      ) : designs.length === 0 ? (
        <EmptyState
          product="design"
          title={q ? t('emptySearch.title') : t(`empty.${folder ? 'folder' : view}.title`)}
          body={q ? t('emptySearch.body', { q }) : t(`empty.${folder ? 'folder' : view}.body`)}
          action={
            view !== 'trash' && !q ? (
              <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>
                {t('create')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className={`dz-cards${loading ? ' is-loading' : ''}`} aria-label={t('listLabel')} data-testid="design-list">
          {designs.map((d) => (
            <li key={d.id} className="dz-card" data-testid="design-card">
              {view === 'trash' ? (
                <div className="dz-card-thumb" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {d.thumb ? <img src={d.thumb} alt="" /> : <span className="dz-card-ph" style={{ aspectRatio: `${d.width} / ${d.height}` }} />}
                </div>
              ) : (
                <Link href={`/app/design/${d.id}`} className="dz-card-thumb" aria-label={t('open', { name: d.name })}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {d.thumb ? <img src={d.thumb} alt="" /> : <span className="dz-card-ph" style={{ aspectRatio: `${d.width} / ${d.height}` }} />}
                </Link>
              )}
              <div className="dz-card-meta">
                <div className="dz-card-text">
                  <span className="dz-card-name">
                    {d.starred && (
                      <span className="dz-card-star" aria-label={t('starred')}>
                        ★
                      </span>
                    )}
                    {d.name}
                  </span>
                  <span className="dz-card-sub">
                    {d.width} × {d.height}
                    {d.pages > 1 ? ` · ${t('pages', { n: d.pages })}` : ''} · {d.access !== 'owner' ? `${d.ownerName} · ` : ''}
                    {relTime(view === 'trash' && d.deletedAt ? d.deletedAt : d.updatedAt, locale)}
                  </span>
                </div>
                <Popover label={t('menu', { name: d.name })} button={<Glyph d={G.more} />} align="right" testId="design-card-menu">
                  {(close) => (
                    <div className="dz-menu" role="menu">
                      {view === 'trash' ? (
                        <>
                          <button type="button" role="menuitem" onClick={() => { close(); void act(`/api/design/designs/${d.id}`, { method: 'PATCH', body: JSON.stringify({ restore: true }) }, t('restored')); }}>
                            {t('restore')}
                          </button>
                          <button type="button" role="menuitem" className="is-danger" onClick={() => { close(); setDialog({ kind: 'purge', d }); }}>
                            {t('deleteForever')}
                          </button>
                        </>
                      ) : (
                        <>
                          <Link href={`/app/design/${d.id}`} role="menuitem">
                            {t('openShort')}
                          </Link>
                          {d.access !== 'view' && (
                            <button type="button" role="menuitem" onClick={() => { close(); setDialog({ kind: 'rename', d }); }} data-testid="design-card-rename">
                              {t('rename')}
                            </button>
                          )}
                          <button type="button" role="menuitem" onClick={() => { close(); void act(`/api/design/designs/${d.id}/duplicate`, { method: 'POST', body: JSON.stringify({ name: t('copyName', { name: d.name }) }) }, t('duplicated')); }}>
                            {t('duplicate')}
                          </button>
                          <button type="button" role="menuitem" onClick={() => { close(); void act(`/api/design/designs/${d.id}`, { method: 'PATCH', body: JSON.stringify({ starred: !d.starred }) }); }}>
                            {d.starred ? t('unstar') : t('star')}
                          </button>
                          {d.access === 'owner' && (
                            <button type="button" role="menuitem" onClick={() => { close(); setDialog({ kind: 'move', d }); }}>
                              {t('move')}
                            </button>
                          )}
                          {(d.access === 'owner' || (d.isTemplate && d.access === 'edit')) && (
                            <button type="button" role="menuitem" className="is-danger" onClick={() => { close(); void act(`/api/design/designs/${d.id}`, { method: 'DELETE' }, t('trashed')); }} data-testid="design-card-delete">
                              {t('trash')}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </Popover>
              </div>
            </li>
          ))}
        </ul>
      )}

      {toast && (
        <div className="ui-toasts" role="status" aria-live="polite">
          <div className="ui-toast">{toast}</div>
        </div>
      )}

      <Modal open={dialog?.kind === 'create'} title={t('createTitle')} onClose={() => setDialog(null)} wide testId="design-create-dialog">
        <div className="dz-presets dz-presets-dialog">
          {DESIGN_PRESETS.map((p) => (
            <button key={p.key} type="button" className="dz-preset" onClick={() => void create({ width: p.w, height: p.h, name: tp(`${p.key}.name`) }, p.key)} disabled={!!creating}>
              <span className="dz-preset-shape" aria-hidden="true">
                <span style={{ aspectRatio: `${p.w} / ${p.h}` }} />
              </span>
              <span className="dz-preset-name">{tp(`${p.key}.name`)}</span>
              <span className="dz-preset-size data">
                {p.w} × {p.h} px
              </span>
            </button>
          ))}
          <button type="button" className="dz-preset" onClick={() => setDialog({ kind: 'custom' })}>
            <span className="dz-preset-shape is-custom" aria-hidden="true">
              <Glyph d={G.plus} size={20} />
            </span>
            <span className="dz-preset-name">{tp('custom.name')}</span>
            <span className="dz-preset-size data">{t('anySize')}</span>
          </button>
        </div>
        <p className="dz-create-more">
          <Link href="/app/design/templates">{t('orTemplate')}</Link>
        </p>
        {creating && (
          <p className="muted" role="status">
            {t('creating')}
          </p>
        )}
      </Modal>

      <CustomSizeDialog open={dialog?.kind === 'custom'} onClose={() => setDialog(null)} onCreate={(w, h) => void create({ width: w, height: h }, 'custom')} busy={!!creating} />

      <NameDialog
        open={dialog?.kind === 'rename' || dialog?.kind === 'renameFolder' || dialog?.kind === 'newFolder'}
        title={dialog?.kind === 'newFolder' ? t('newFolder') : t('rename')}
        initial={dialog?.kind === 'rename' ? dialog.d.name : dialog?.kind === 'renameFolder' ? dialog.f.name : ''}
        onClose={() => setDialog(null)}
        onSubmit={async (name) => {
          if (dialog?.kind === 'rename') await act(`/api/design/designs/${dialog.d.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
          if (dialog?.kind === 'renameFolder') await act(`/api/design/folders/${dialog.f.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
          if (dialog?.kind === 'newFolder') await act('/api/design/folders', { method: 'POST', body: JSON.stringify({ name }) });
          setDialog(null);
        }}
      />

      <Modal open={dialog?.kind === 'move'} title={t('moveTitle')} onClose={() => setDialog(null)}>
        {dialog?.kind === 'move' && (
          <div className="dz-move">
            <button type="button" className={`dz-move-opt${!dialog.d.folderId ? ' is-on' : ''}`} onClick={() => void act(`/api/design/designs/${dialog.d.id}`, { method: 'PATCH', body: JSON.stringify({ folderId: null }) }).then(() => setDialog(null))}>
              {t('noFolder')}
            </button>
            {folders.map((f) => (
              <button key={f.id} type="button" className={`dz-move-opt${dialog.d.folderId === f.id ? ' is-on' : ''}`} onClick={() => void act(`/api/design/designs/${dialog.d.id}`, { method: 'PATCH', body: JSON.stringify({ folderId: f.id }) }, t('moved', { folder: f.name })).then(() => setDialog(null))}>
                {f.name}
              </button>
            ))}
            {!folders.length && <p className="muted">{t('noFolders')}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={dialog?.kind === 'purge' || dialog?.kind === 'deleteFolder'}
        title={dialog?.kind === 'purge' ? t('deleteForever') : t('deleteFolder')}
        onClose={() => setDialog(null)}
        foot={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                if (dialog?.kind === 'purge') await act(`/api/design/designs/${dialog.d.id}?forever=1`, { method: 'DELETE' });
                if (dialog?.kind === 'deleteFolder') {
                  if (await act(`/api/design/folders/${dialog.f.id}`, { method: 'DELETE' })) router.push('/app/design');
                }
                setDialog(null);
              }}
            >
              {t('confirmDelete')}
            </button>
          </>
        }
      >
        <p>{dialog?.kind === 'purge' ? t('purgeBody', { name: dialog.d.name }) : dialog?.kind === 'deleteFolder' ? t('deleteFolderBody', { name: dialog.f.name }) : ''}</p>
      </Modal>
    </div>
  );
}

function NameDialog({ open, title, initial, onClose, onSubmit }: { open: boolean; title: string; initial: string; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const t = useTranslations('design.home');
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      testId="design-name-dialog"
      foot={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="dz-name-form" className="btn btn-primary" disabled={busy || !value.trim()}>
            {t('save')}
          </button>
        </>
      }
    >
      <form
        id="dz-name-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim()) return;
          setBusy(true);
          await onSubmit(value.trim());
          setBusy(false);
        }}
      >
        <label className="ui-field">
          <span className="label">{t('name')}</span>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input className="input" value={value} maxLength={120} autoFocus onChange={(e) => setValue(e.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

function CustomSizeDialog({ open, onClose, onCreate, busy }: { open: boolean; onClose: () => void; onCreate: (w: number, h: number) => void; busy: boolean }) {
  const t = useTranslations('design.home');
  const [w, setW] = useState('1200');
  const [h, setH] = useState('800');
  const wn = Number(w);
  const hn = Number(h);
  const valid = Number.isInteger(wn) && Number.isInteger(hn) && wn >= MIN_SIDE && wn <= MAX_SIDE && hn >= MIN_SIDE && hn <= MAX_SIDE;
  return (
    <Modal
      open={open}
      title={t('customTitle')}
      onClose={onClose}
      testId="design-custom-dialog"
      foot={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="dz-custom-form" className="btn btn-primary" disabled={!valid || busy}>
            {t('createShort')}
          </button>
        </>
      }
    >
      <form
        id="dz-custom-form"
        className="dz-wh"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onCreate(wn, hn);
        }}
      >
        <label className="ui-field">
          <span className="label">{t('width')}</span>
          <input className="input" type="number" min={MIN_SIDE} max={MAX_SIDE} value={w} onChange={(e) => setW(e.target.value)} data-testid="design-custom-w" />
        </label>
        <label className="ui-field">
          <span className="label">{t('height')}</span>
          <input className="input" type="number" min={MIN_SIDE} max={MAX_SIDE} value={h} onChange={(e) => setH(e.target.value)} data-testid="design-custom-h" />
        </label>
        {!valid && <p className="ui-error">{t('sizeInvalid', { min: MIN_SIDE, max: MAX_SIDE })}</p>}
      </form>
    </Modal>
  );
}
