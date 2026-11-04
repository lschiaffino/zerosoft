'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import type { LinkDto } from '@/lib/send/core';
import LinkDialog from './LinkDialog';
import { api, useDate, useErrorText, useToast } from './ui';

/** Los links de un documento o espacio: copiar, cortar, editar, borrar. */
export default function LinksPanel({
  links,
  setLinks,
  createUrl,
  templates,
  canCreate,
}: {
  links: LinkDto[];
  setLinks: (fn: (x: LinkDto[]) => LinkDto[]) => void;
  createUrl: string;
  templates: Array<{ id: string; name: string }>;
  canCreate: boolean;
}) {
  const t = useTranslations('send.link');
  const tc = useTranslations('send.common');
  const locale = useLocale();
  const date = useDate();
  const errorText = useErrorText();
  const [toasts, toast] = useToast();
  const [editing, setEditing] = useState<LinkDto | 'new' | null>(null);
  const [removing, setRemoving] = useState<LinkDto | null>(null);
  const [busy, setBusy] = useState(false);

  const urlOf = (l: LinkDto) => (l.path ? `${window.location.origin}/${locale}${l.path}` : '');
  const write = (l: LinkDto) => navigator.clipboard?.writeText(urlOf(l)).catch(() => undefined);
  const copy = async (l: LinkDto) => {
    await write(l);
    toast(t('copied'));
  };
  const toggle = async (l: LinkDto) => {
    const r = await api<{ link: LinkDto }>(`/api/send/links/${l.id}`, { method: 'PATCH', json: { disabled: l.state !== 'disabled' } });
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    setLinks((x) => x.map((i) => (i.id === l.id ? { ...i, ...r.data.link, visits: i.visits, visitors: i.visitors } : i)));
    toast(l.state === 'disabled' ? t('enabledToast') : t('disabledToast'));
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const r = await api(`/api/send/links/${removing.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    setLinks((x) => x.filter((i) => i.id !== removing.id));
    setRemoving(null);
    toast(t('deletedToast'));
  };

  const tags = (l: LinkDto) =>
    [
      l.hasPasscode && t('tagPasscode'),
      l.verifyEmail ? t('tagVerified') : l.requireEmail && t('tagEmail'),
      l.accessMode === 'allow' && t('tagAllow'),
      l.accessMode === 'block' && t('tagBlock'),
      l.watermark && t('tagWatermark'),
      l.ndaTemplateId && t('tagNda'),
      l.allowDownload ? t('tagDownload') : t('tagNoDownload'),
      l.expiresAt && t('tagExpires', { date: date(l.expiresAt, false) }),
    ].filter(Boolean) as string[];

  return (
    <section data-testid="send-links">
      {toasts}
      <div className="sd-section-head">
        <h2>{t('title')}</h2>
        {canCreate && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')} data-testid="send-link-new">
            {t('new')}
          </button>
        )}
      </div>
      {links.length === 0 ? (
        <EmptyState compact body={canCreate ? t('empty') : t('emptyNotReady')} />
      ) : (
        <ul className="sd-links">
          {links.map((l) => (
            <li key={l.id} className="sd-link" data-testid="send-link-row" data-state={l.state}>
              <div className="sd-link-main">
                <div className="sd-link-title">
                  <strong>{l.name || t('unnamed')}</strong>
                  {l.state !== 'active' && <span className={`badge ${l.state === 'disabled' ? 'badge-outline' : 'badge-warn'}`}>{t(`state.${l.state}`)}</span>}
                  {l.state === 'active' && l.problem && (
                    <span className="badge badge-warn" data-testid="send-link-problem">
                      {t('notServing')}
                    </span>
                  )}
                </div>
                {l.state === 'active' && l.problem && (
                  <span className="sd-rowmeta" data-testid="send-link-problem-text" data-problem={l.problem}>
                    {t(`problem_${l.problem}`)}
                  </span>
                )}
                {l.recipientEmail && <span className="sd-rowmeta">{t('forRecipient', { email: l.recipientEmail })}</span>}
                <span className="sd-rowmeta">{tags(l).join(' · ')}</span>
                <span className="sd-rowmeta">
                  {t('visits', { count: l.visits })} · {t('visitors', { count: l.visitors })}
                  {l.lastVisitAt ? ` · ${t('last', { date: date(l.lastVisitAt) })}` : ''}
                </span>
              </div>
              <div className="sd-link-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(l)} disabled={!l.path} data-testid="send-link-copy" data-url={l.path ?? ''}>
                  {t('copy')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(l)} data-testid="send-link-edit">
                  {tc('edit')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(l)} data-testid="send-link-toggle">
                  {l.state === 'disabled' ? t('enable') : t('disable')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setRemoving(l)} data-testid="send-link-delete">
                  {tc('delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <LinkDialog
        open={editing !== null}
        link={editing && editing !== 'new' ? editing : null}
        createUrl={createUrl}
        templates={templates}
        onClose={() => setEditing(null)}
        onSaved={(link, created) => {
          setLinks((x) => (created ? [link, ...x] : x.map((i) => (i.id === link.id ? { ...link, visits: i.visits, visitors: i.visitors } : i))));
          setEditing(null);
          if (created) void write(link);
          toast(created ? t('createdToast') : t('savedToast'));
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={t('deleteTitle')}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
