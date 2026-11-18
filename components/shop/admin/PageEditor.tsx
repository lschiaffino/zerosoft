'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ShopPageDto } from '@/lib/shop-pages';
import { api, useErrorText, useToast } from './shop-ui';

/** Editor de una página o un artículo: título, texto con formato básico, dirección y buscadores. */
export default function PageEditor({ page, kind, storeHandle }: { page: ShopPageDto | null; kind: 'page' | 'article'; storeHandle: string }) {
  const t = useTranslations('shop');
  const router = useRouter();
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [title, setTitle] = useState(page?.title ?? '');
  const [handle, setHandle] = useState(page?.handle ?? '');
  const [body, setBody] = useState(page?.body ?? '');
  const [published, setPublished] = useState(page?.published ?? true);
  const [seoTitle, setSeoTitle] = useState(page?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(page?.seoDescription ?? '');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const wrap = (open: string, close: string) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    setBody(`${body.slice(0, a)}${open}${body.slice(a, b)}${close}${body.slice(b)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + open.length, b + open.length);
    });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const json = { kind, title, handle: handle || undefined, body, published, seoTitle, seoDescription };
    const res = page
      ? await api<{ page?: ShopPageDto }>(`/api/shop/pages/${page.id}`, { method: 'PATCH', json })
      : await api<{ page?: ShopPageDto }>('/api/shop/pages', { method: 'POST', json });
    setSaving(false);
    if (!res.ok || !res.data.page) return push(errText(res.data.error), 'bad');
    push(t('editor.saved'));
    setHandle(res.data.page.handle);
    if (!page) router.replace(`/app/shop/pages/${res.data.page.id}`);
    else router.refresh();
  };
  const remove = async () => {
    const res = await api(`/api/shop/pages/${page!.id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    router.replace('/app/shop/pages');
    router.refresh();
  };
  const path = kind === 'article' ? 'blog' : 'pages';
  return (
    <div className="app-page ui-page shop-page shop-narrow">
      <PageHeader back={{ href: '/app/shop/pages', label: t('pages.title') }} title={page ? page.title : kind === 'article' ? t('pages.newArticle') : t('pages.newPage')} />
      <form className="panel shop-panel" onSubmit={save}>
        <label className="ui-field">
          <span className="label">{t('pages.colTitle')}</span>
          <input className="input" required autoFocus={!page} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} name="title" />
        </label>
        <div className="ui-field">
          <label className="label" htmlFor="pg-body">{t('pages.body')}</label>
          <div className="shop-format-bar" role="toolbar" aria-label={t('pages.format')}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => wrap('<strong>', '</strong>')}>{t('pages.bold')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => wrap('<em>', '</em>')}>{t('pages.italic')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => wrap('<a href="https://">', '</a>')}>{t('pages.link')}</button>
          </div>
          <textarea id="pg-body" ref={area} className="textarea" rows={14} maxLength={100000} value={body} onChange={(e) => setBody(e.target.value)} name="body" />
          <span className="ui-help">{t('pages.bodyHelp')}</span>
        </div>
        <label className="ui-field">
          <span className="label">{t('pages.handle')}</span>
          <input className="input data" maxLength={64} value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} placeholder={t('pages.handlePh')} />
          <span className="ui-help">/store/{storeHandle}/{path}/{handle || '…'}</span>
        </label>
        <label className="ui-field">
          <span className="label">{t('editor.seoTitle')}</span>
          <input className="input" maxLength={120} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
        </label>
        <label className="ui-field">
          <span className="label">{t('editor.seoDescription')}</span>
          <textarea className="textarea" rows={2} maxLength={320} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} />
        </label>
        <label className="ui-check">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          <span>{t('pages.visible')}</span>
        </label>
        <div className="shop-actions-row">
          <button type="submit" className="btn btn-primary" aria-busy={saving} disabled={saving}>{t('editor.save')}</button>
          {page && (
            <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>{t('editor.delete')}</button>
          )}
        </div>
      </form>
      <ConfirmDialog open={confirm} danger title={t('pages.deleteTitle', { title: page?.title ?? '' })} body={t('pages.deleteBody')} confirmLabel={t('editor.delete')} cancelLabel={t('common.cancel')} onConfirm={() => void remove()} onCancel={() => setConfirm(false)} />
      {toast}
    </div>
  );
}
