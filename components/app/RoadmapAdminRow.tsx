'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { RoadmapItemRow, RoadmapSignalRow } from '@/lib/db';
import { FEEDBACK_PRODUCTS } from '@/lib/feedback-constants';
import {
  ROADMAP_KINDS,
  ROADMAP_STATUSES,
  type RoadmapKind,
  type RoadmapStatus,
} from '@/lib/roadmap-constants';
import { formatDateTime } from '@/lib/utils';
import AdvancedSection from '@/components/ui/AdvancedSection';
import ProductTag from './ProductTag';

export type AdminItem = RoadmapItemRow & { signals: RoadmapSignalRow[] };
type Item = AdminItem;

interface Draft {
  title: string;
  description: string;
  status: RoadmapStatus;
  product: string;
  kind: RoadmapKind;
  isPublic: boolean;
  shippedChangelogId: string;
  declinedReason: string;
}

function toDraft(i: Item): Draft {
  return {
    title: i.title,
    description: i.description,
    status: i.status,
    product: i.product,
    kind: i.kind,
    isPublic: i.is_public === 1,
    shippedChangelogId: i.shipped_changelog_id ?? '',
    declinedReason: i.declined_reason ?? '',
  };
}

/** Formulario de un ítem del roadmap (panel del kanban y de la lista): editar, publicar y fusionar. */
export function RoadmapAdminRow({
  item,
  targets,
  locale,
  t,
  onSaved,
  onMerged,
}: {
  item: Item;
  targets: Array<{ id: string; title: string }>;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  onSaved: (next: RoadmapItemRow) => void;
  onMerged: (target: RoadmapItemRow) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(item));
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [mergeTarget, setMergeTarget] = useState('');
  const tp = useTranslations('feedbackBoard.product');

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setState('idle');
  }

  async function save(patch: Partial<Draft> = {}) {
    const next = { ...draft, ...patch };
    setDraft(next);
    setBusy(true);
    const res = await fetch(`/api/roadmap/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...next,
        shippedChangelogId: next.shippedChangelogId.trim() || null,
        declinedReason: next.declinedReason.trim() || null,
      }),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { item?: RoadmapItemRow } | null) : null;
    if (data?.item) {
      onSaved(data.item);
      setState('saved');
    } else {
      setState('error');
    }
    setBusy(false);
  }

  async function merge() {
    if (!mergeTarget || !window.confirm(t('admin.mergeConfirm'))) return;
    setBusy(true);
    const res = await fetch('/api/roadmap/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId: item.id, targetId: mergeTarget }),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { item?: RoadmapItemRow } | null) : null;
    setBusy(false);
    if (data?.item) onMerged(data.item);
    else setState('error');
  }

  const id = `rm-${item.id}`;
  const statusId = `${id}-status`;
  return (
    <article className="st-rm" aria-label={item.title}>
      <div className="st-rm-meta">
        <ProductTag product={draft.product} label={tp(draft.product)} />
        <span className="data">{t('votes', { count: item.votes })}</span>
        <span>{t('admin.signals', { count: item.signals.length })}</span>
        <span className={`badge ${item.is_public === 1 ? 'badge-outline' : ''}`}>
          {item.is_public === 1 ? t('admin.public') : t('admin.private')}
        </span>
        <span className="data st-muted">{formatDateTime(item.created_at, locale)}</span>
      </div>

      <form
        className="st-rm-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.title.trim()) void save();
        }}
      >
        <div className="st-rm-grid">
          <div className="ui-field st-rm-wide">
            <label className="label" htmlFor={`${id}-title`}>
              {t('admin.titleLabel')}
            </label>
            <input className="input" id={`${id}-title`} value={draft.title} maxLength={160} onChange={(e) => set('title', e.target.value)} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={statusId}>
              {t('admin.statusLabel')}
            </label>
            <select
              id={statusId}
              className="select"
              value={draft.status}
              onChange={(e) => save({ status: e.target.value as RoadmapStatus })}
              disabled={busy}
            >
              {ROADMAP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-product`}>
              {t('admin.productLabel')}
            </label>
            <select id={`${id}-product`} className="select" value={draft.product} onChange={(e) => set('product', e.target.value)}>
              {FEEDBACK_PRODUCTS.map((p) => (
                <option key={p} value={p}>
                  {tp(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-kind`}>
              {t('admin.kindLabel')}
            </label>
            <select id={`${id}-kind`} className="select" value={draft.kind} onChange={(e) => set('kind', e.target.value as RoadmapKind)}>
              {ROADMAP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field st-rm-wide">
            <label className="label" htmlFor={`${id}-desc`}>
              {t('admin.descriptionLabel')}
            </label>
            <textarea
              id={`${id}-desc`}
              className="textarea"
              rows={3}
              value={draft.description}
              maxLength={4000}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          {draft.status === 'declined' && (
            <div className="ui-field st-rm-wide">
              <label className="label" htmlFor={`${id}-declined`}>
                {t('admin.declinedReasonLabel')}
              </label>
              <textarea
                id={`${id}-declined`}
                className="textarea"
                rows={2}
                value={draft.declinedReason}
                maxLength={1000}
                onChange={(e) => set('declinedReason', e.target.value)}
              />
              <span className="ui-help">{t('admin.declinedReasonHint')}</span>
            </div>
          )}
          {draft.status === 'done' && (
            <div className="ui-field st-rm-wide">
              <label className="label" htmlFor={`${id}-changelog`}>
                {t('admin.changelogLabel')}
              </label>
              <input
                id={`${id}-changelog`}
                className="input data"
                value={draft.shippedChangelogId}
                maxLength={120}
                pattern="[A-Za-z0-9_-]*"
                onChange={(e) => set('shippedChangelogId', e.target.value)}
              />
              <span className="ui-help">{t('admin.changelogHint')}</span>
            </div>
          )}
        </div>

        <div className="st-rm-foot">
          <label className="ui-switch">
            <input type="checkbox" role="switch" checked={draft.isPublic} disabled={busy} onChange={(e) => save({ isPublic: e.target.checked })} />
            {t('admin.public')}
          </label>
          <span className="st-rm-state" role="status" aria-live="polite" data-tone={state === 'error' ? 'error' : state === 'saved' ? 'ok' : undefined}>
            {state === 'saved' ? t('admin.saved') : state === 'error' ? t('admin.error') : ''}
          </span>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.title.trim()} aria-busy={busy || undefined}>
            {t('admin.save')}
          </button>
        </div>
      </form>

      {(targets.length > 0 || item.signals.length > 0) && (
        <div className="st-rm-more">
          {item.signals.length > 0 && (
            <AdvancedSection storageKey="settings.roadmap.signals" label={t('admin.excerpts')} hint={String(item.signals.length)}>
              <ul className="st-rm-signals">
                {item.signals.map((s) => (
                  <li key={s.id}>
                    <span className="badge">{t(`admin.source.${s.source}`)}</span>
                    {s.source === 'chat' ? (
                      <Link href={`/app/chat/inbox/${s.source_id}`} className="st-inline-link">
                        {s.excerpt || s.source_id}
                      </Link>
                    ) : (
                      <span>{s.excerpt}</span>
                    )}
                  </li>
                ))}
              </ul>
            </AdvancedSection>
          )}
          {targets.length > 0 && (
            <AdvancedSection storageKey="settings.roadmap.merge" label={t('admin.merge')} hint={t('admin.mergeInto')}>
              <div className="st-create">
                <div className="ui-field st-create-field">
                  <label className="sr-only" htmlFor={`${id}-merge`}>
                    {t('admin.mergeInto')}
                  </label>
                  <select id={`${id}-merge`} className="select" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                    <option value="">{t('admin.mergeInto')}</option>
                    {targets.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !mergeTarget} onClick={merge}>
                  {t('admin.merge')}
                </button>
              </div>
            </AdvancedSection>
          )}
        </div>
      )}
    </article>
  );
}
