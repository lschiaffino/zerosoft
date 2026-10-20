'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatAgent } from '@/lib/chat-data';
import type { BulkAction } from '@/lib/chat-inbox';
import { SNOOZE_OPTIONS } from './inbox-model';

interface BulkBarProps {
  selected: ReadonlySet<string>;
  /** Ids de la lista visible (para "elegir todas"). */
  visibleIds: string[];
  agents: ChatAgent[];
  currentUserId: string;
  onSelect: (next: Set<string>) => void;
  /** Después de aplicar: refrescar la lista. */
  onDone: () => void;
}

/**
 * Acciones en lote sobre las conversaciones elegidas: asignar, sumar un tag,
 * posponer y resolver (las mismas que existen de a una en la conversación).
 */
export default function BulkBar({ selected, visibleIds, agents, currentUserId, onSelect, onDone }: BulkBarProps) {
  const t = useTranslations('chat');
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const count = selected.size;
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  async function run(action: BulkAction) {
    if (busy || count === 0) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/chat/conversations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], action }),
      });
      if (!res.ok) throw new Error('bulk_failed');
      const data = (await res.json()) as { updated: number; skipped: number };
      setStatus({
        tone: 'ok',
        text: data.skipped > 0 ? t('bulk.doneSkipped', { count: data.updated, skipped: data.skipped }) : t('bulk.done', { count: data.updated }),
      });
      if (action.type === 'tag') setTag('');
      // Resolver o posponer saca las conversaciones de la vista de abiertas: se limpia la selección.
      if (action.type === 'resolve' || action.type === 'snooze') onSelect(new Set());
      onDone();
    } catch {
      setStatus({ tone: 'error', text: t('errors.generic') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-bulk" role="region" aria-label={t('bulk.label')} aria-busy={busy || undefined}>
      <div className="chat-bulk-top">
        <label className="ui-check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onSelect(e.target.checked ? new Set([...selected, ...visibleIds]) : new Set())}
          />
          {t('bulk.selected', { count })}
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect(new Set())}>
          {t('bulk.clear')}
        </button>
      </div>
      <div className="chat-bulk-actions">
        <label className="sr-only" htmlFor="chat-bulk-assign">
          {t('bulk.assign')}
        </label>
        <select
          id="chat-bulk-assign"
          className="select chat-compact-select"
          value=""
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value;
            if (v) void run({ type: 'assign', assignedTo: v === '__none' ? null : v });
          }}
        >
          <option value="">{t('bulk.assign')}</option>
          <option value="__none">{t('conversation.unassigned')}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id === currentUserId ? t('conversation.assignedToYou') : a.name || a.email}
              {a.away ? ` (${t('away.away')})` : ''}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="chat-bulk-snooze">
          {t('conversation.snoozeLabel')}
        </label>
        <select
          id="chat-bulk-snooze"
          className="select chat-compact-select"
          value=""
          disabled={busy}
          onChange={(e) => {
            const ms = Number(e.target.value);
            if (ms > 0) void run({ type: 'snooze', until: new Date(Date.now() + ms).toISOString() });
          }}
        >
          <option value="">{t('conversation.snoozeLabel')}</option>
          {SNOOZE_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.value}>
              {t(`conversation.snooze.${opt.key}`)}
            </option>
          ))}
        </select>
        <form
          className="chat-bulk-tag"
          onSubmit={(e) => {
            e.preventDefault();
            if (tag.trim()) void run({ type: 'tag', tag: tag.trim() });
          }}
        >
          <label className="sr-only" htmlFor="chat-bulk-tag">
            {t('bulk.tag')}
          </label>
          <input
            id="chat-bulk-tag"
            className="input"
            value={tag}
            maxLength={40}
            placeholder={t('bulk.tag')}
            onChange={(e) => setTag(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !tag.trim()}>
            {t('bulk.addTag')}
          </button>
        </form>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run({ type: 'resolve' })}>
          {t('conversation.resolve')}
        </button>
      </div>
      <p className={status?.tone === 'error' ? 'ui-error chat-bulk-status' : 'chat-bulk-status'} role="status">
        {status?.text ?? ''}
      </p>
    </div>
  );
}
