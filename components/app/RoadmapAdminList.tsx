'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { RoadmapItemRow, RoadmapSignalRow } from '@/lib/db';
import { FEEDBACK_PRODUCTS } from '@/lib/feedback-constants';
import {
  ROADMAP_KINDS,
  ROADMAP_PRODUCT_COLOR,
  ROADMAP_STATUSES,
  type RoadmapKind,
  type RoadmapStatus,
} from '@/lib/roadmap-constants';
import { formatDateTime } from '@/lib/utils';

type Item = RoadmapItemRow & { signals: RoadmapSignalRow[] };

interface Draft {
  title: string;
  description: string;
  status: RoadmapStatus;
  product: string;
  kind: RoadmapKind;
  isPublic: boolean;
  shippedChangelogId: string;
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
  };
}

/** Lista del admin: editar, cambiar estado, publicar y fusionar ítems. */
export default function RoadmapAdminList({
  initial,
  targets,
  locale,
}: {
  initial: Item[];
  targets: Array<{ id: string; title: string }>;
  locale: string;
}) {
  const t = useTranslations('roadmap');
  const [items, setItems] = useState(initial);
  const [allTargets, setAllTargets] = useState(targets);

  function replace(id: string, next: Item | null) {
    setItems((prev) => (next ? prev.map((i) => (i.id === id ? next : i)) : prev.filter((i) => i.id !== id)));
  }

  async function onMerged(sourceId: string, target: RoadmapItemRow) {
    setAllTargets((prev) => prev.filter((x) => x.id !== sourceId));
    setItems((prev) => {
      const source = prev.find((i) => i.id === sourceId);
      return prev
        .filter((i) => i.id !== sourceId)
        .map((i) =>
          i.id === target.id
            ? {
                ...i,
                ...target,
                signals: [...(source?.signals ?? []).map((s) => ({ ...s, item_id: target.id })), ...i.signals],
              }
            : i,
        );
    });
  }

  return (
    <div className="rm-admin-list">
      {items.map((item) => (
        <RoadmapAdminRow
          key={item.id}
          item={item}
          targets={allTargets.filter((x) => x.id !== item.id)}
          locale={locale}
          t={t}
          onSaved={(next) => replace(item.id, { ...item, ...next })}
          onMerged={(target) => onMerged(item.id, target)}
        />
      ))}
    </div>
  );
}

function RoadmapAdminRow({
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
      body: JSON.stringify({ ...next, shippedChangelogId: next.shippedChangelogId.trim() || null }),
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
  return (
    <article className="rm-admin-row" style={{ '--dot': ROADMAP_PRODUCT_COLOR[draft.product] ?? 'var(--dim)' } as CSSProperties}>
      <div className="rm-admin-head">
        <span className="rm-dot" aria-hidden="true" />
        <strong>{t('votes', { count: item.votes })}</strong>
        <span>{t('admin.signals', { count: item.signals.length })}</span>
        <span>{item.is_public === 1 ? t('admin.public') : t('admin.private')}</span>
        <span>{formatDateTime(item.created_at, locale)}</span>
      </div>

      <div className="rm-admin-grid">
        <label className="rm-admin-field">
          <span className="label">{t('admin.titleLabel')}</span>
          <input className="input" id={`${id}-title`} value={draft.title} maxLength={160} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="rm-admin-field">
          <span className="label">{t('admin.statusLabel')}</span>
          <select className="select" value={draft.status} onChange={(e) => save({ status: e.target.value as RoadmapStatus })} disabled={busy}>
            {ROADMAP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="rm-admin-field">
          <span className="label">{t('admin.productLabel')}</span>
          <select className="select" value={draft.product} onChange={(e) => set('product', e.target.value)}>
            {FEEDBACK_PRODUCTS.map((p) => (
              <option key={p} value={p}>
                {t(`product.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="rm-admin-field">
          <span className="label">{t('admin.kindLabel')}</span>
          <select className="select" value={draft.kind} onChange={(e) => set('kind', e.target.value as RoadmapKind)}>
            {ROADMAP_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="rm-admin-field rm-admin-wide">
          <span className="label">{t('admin.descriptionLabel')}</span>
          <textarea
            className="textarea"
            value={draft.description}
            maxLength={4000}
            onChange={(e) => set('description', e.target.value)}
          />
        </label>
        {draft.status === 'done' && (
          <label className="rm-admin-field rm-admin-wide">
            <span className="label">{t('admin.changelogLabel')}</span>
            <input
              className="input mono"
              value={draft.shippedChangelogId}
              maxLength={120}
              pattern="[A-Za-z0-9_-]*"
              onChange={(e) => set('shippedChangelogId', e.target.value)}
            />
            <span className="rm-admin-hint">{t('admin.changelogHint')}</span>
          </label>
        )}
      </div>

      <div className="rm-admin-actions">
        <label className="rm-admin-check">
          <input type="checkbox" checked={draft.isPublic} disabled={busy} onChange={(e) => save({ isPublic: e.target.checked })} />
          {t('admin.public')}
        </label>
        <button type="button" className="btn btn-solid btn-small" disabled={busy || !draft.title.trim()} onClick={() => save()}>
          {t('admin.save')}
        </button>
        {state === 'saved' && <span className="rm-admin-status">{t('admin.saved')}</span>}
        {state === 'error' && <span className="rm-admin-status is-error">{t('admin.error')}</span>}
        {targets.length > 0 && (
          <>
            <select className="select" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} aria-label={t('admin.mergeInto')}>
              <option value="">{t('admin.mergeInto')}</option>
              {targets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy || !mergeTarget} onClick={merge}>
              {t('admin.merge')}
            </button>
          </>
        )}
      </div>

      {item.signals.length > 0 && (
        <details className="rm-admin-signals">
          <summary>
            {t('admin.excerpts')} ({item.signals.length})
          </summary>
          <ul>
            {item.signals.map((s) => (
              <li key={s.id}>
                <span className="rm-admin-src">{t(`admin.source.${s.source}`)}</span>
                {s.source === 'chat' ? (
                  <Link href={`/app/chat/inbox/${s.source_id}`}>{s.excerpt || s.source_id}</Link>
                ) : (
                  s.excerpt
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
