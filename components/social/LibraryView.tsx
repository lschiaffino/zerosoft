'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import type { LibraryItem, LibraryKind } from '@/lib/social';
import type { MediaItem } from '@/lib/social-networks';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { api, fmtDateTime, useErrorText, useToast } from './shared';

/**
 * Biblioteca del workspace: textos guardados, grupos de hashtags y archivos
 * (fotos y videos) para usar en el compositor. ?kind= elige la pestaña y
 * ?item= abre uno para renombrarlo, editarlo o borrarlo.
 */
export default function LibraryView({ items, kind }: { items: LibraryItem[]; kind: LibraryKind | 'all' }) {
  const t = useTranslations('social.library');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const errorText = useErrorText();
  const [toast, showToast] = useToast();
  const openId = sp.get('item');
  const open = items.find((i) => i.id === openId) ?? null;
  const [form, setForm] = useState<{ kind: LibraryKind; name: string; body: string; media: MediaItem[] }>({ kind: kind === 'all' ? 'snippet' : kind, name: '', body: '', media: [] });
  const [edit, setEdit] = useState<{ name: string; body: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEdit(open ? { name: open.name, body: open.body } : null);
    if (open) setTimeout(() => editRef.current?.focus(), 0);
  }, [open]);

  const shown = kind === 'all' ? items : items.filter((i) => i.kind === kind);
  const tabHref = (k: string) => (k === 'all' ? '/app/social/library' : `/app/social/library?kind=${k}`);
  const close = () => {
    const q = new URLSearchParams(sp.toString());
    q.delete('item');
    router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`);
  };

  async function uploadAsset(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy('upload');
    try {
      const fd = new FormData();
      fd.set('file', file);
      const item = await api<MediaItem>('/upload', { method: 'POST', body: fd });
      setForm((f) => ({ ...f, media: [item], name: f.name || file.name }));
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function create() {
    if (!form.name.trim()) return;
    setBusy('create');
    try {
      await api('/library', { method: 'POST', json: form });
      setForm({ kind: form.kind, name: '', body: '', media: [] });
      showToast(t('created'));
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!open || !edit?.name.trim()) return;
    setBusy('save');
    try {
      await api(`/library/${open.id}`, { method: 'PATCH', json: edit });
      showToast(t('saved'));
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!open) return;
    setBusy('delete');
    try {
      await api(`/library/${open.id}`, { method: 'DELETE' });
      setConfirm(false);
      close();
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sc-page">
      <nav className="ui-tabs" aria-label={t('title')}>
        {(['all', 'snippet', 'hashtags', 'asset'] as const).map((k) => (
          <Link key={k} className="ui-tab" href={tabHref(k)} aria-current={kind === k ? 'page' : undefined}>
            {t(`kind_${k}`)}
          </Link>
        ))}
      </nav>

      <form
        className="sc-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        aria-labelledby="sc-lib-new"
      >
        <h2 id="sc-lib-new">{t('new')}</h2>
        <div className="ui-fields ui-fields-2">
          <label className="ui-field">
            <span className="label">{t('kind')}</span>
            <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as LibraryKind, media: [] })}>
              <option value="snippet">{t('kind_snippet')}</option>
              <option value="hashtags">{t('kind_hashtags')}</option>
              <option value="asset">{t('kind_asset')}</option>
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('name')}</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} data-testid="library-name" />
          </label>
        </div>
        {form.kind === 'asset' ? (
          <div className="sc-row">
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} aria-busy={busy === 'upload'}>
              {form.media.length ? t('replaceFile') : t('chooseFile')}
            </button>
            <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm" onChange={(e) => void uploadAsset(e.target.files)} />
            {form.media[0] && <span className="sc-muted sc-small">{form.media[0].name}</span>}
          </div>
        ) : (
          <label className="ui-field">
            <span className="label">{form.kind === 'hashtags' ? t('hashtags') : t('text')}</span>
            <textarea className="textarea" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={form.kind === 'hashtags' ? '#launch #product' : ''} />
          </label>
        )}
        <div className="sc-actions">
          <button type="submit" className="btn btn-primary" disabled={!form.name.trim() || busy === 'create' || (form.kind === 'asset' && !form.media.length)} aria-busy={busy === 'create'}>
            {t('save')}
          </button>
        </div>
      </form>

      {shown.length === 0 ? (
        <div className="ui-empty">
          <p className="ui-empty-title">{t('emptyTitle')}</p>
          <p className="ui-empty-body">{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="sc-list" data-testid="library-list">
          {shown.map((i) => (
            <Link key={i.id} className="sc-item" href={`/app/social/library?${kind !== 'all' ? `kind=${kind}&` : ''}item=${i.id}`} aria-current={i.id === openId ? 'true' : undefined}>
              <div className="sc-item-main">
                <strong>{i.name}</strong>
                <span className="sc-item-text sc-muted">{i.kind === 'asset' ? (i.media[0]?.name ?? '') : i.body}</span>
              </div>
              <div className="sc-item-side">
                <span className="sc-muted sc-small">{t(`kind_${i.kind}`)}</span>
                <span className="sc-muted sc-small">{fmtDateTime(i.updatedAt, locale)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {open && edit && (
        <form
          className="sc-panel"
          aria-labelledby="sc-lib-edit"
          data-testid="library-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
        >
          <h2 id="sc-lib-edit">{t('editTitle')}</h2>
          <label className="ui-field">
            <span className="label">{t('name')}</span>
            <input ref={editRef} className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={120} />
          </label>
          {open.kind === 'asset' ? (
            open.media[0] &&
            (open.media[0].type === 'video' ? (
              <video className="sc-preview-media" src={open.media[0].url} controls preload="metadata" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="sc-preview-media" src={open.media[0].url} alt={open.name} />
            ))
          ) : (
            <label className="ui-field">
              <span className="label">{open.kind === 'hashtags' ? t('hashtags') : t('text')}</span>
              <textarea className="textarea" rows={4} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            </label>
          )}
          <div className="sc-actions">
            <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
              {t('delete')}
            </button>
            <button type="button" className="btn" onClick={close}>
              {t('close')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!edit.name.trim() || busy === 'save'} aria-busy={busy === 'save'}>
              {t('saveChanges')}
            </button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirm}
        title={t('deleteTitle', { name: open?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy === 'delete'}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      />
      {toast}
    </div>
  );
}
