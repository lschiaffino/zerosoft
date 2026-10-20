'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

type Choice = 'available' | 'away' | 'awayReassign';

/**
 * Estado del agente en la cabecera del inbox: disponible o ausente. Ausente
 * saca al agente del round-robin; "ausente y reasignar" además pasa sus
 * conversaciones abiertas y pendientes a otros agentes disponibles.
 */
export default function AwayStatus({ initialAway, onChange }: { initialAway: boolean; onChange: () => void }) {
  const t = useTranslations('chat');
  const [away, setAway] = useState(initialAway);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function choose(choice: Choice) {
    const nextAway = choice !== 'available';
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/chat/agent-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ away: nextAway, reassign: choice === 'awayReassign' }),
      });
      if (!res.ok) throw new Error('status_failed');
      const data = (await res.json()) as { away: boolean; reassigned: number };
      setAway(data.away);
      if (choice === 'awayReassign') {
        setNote({ tone: 'ok', text: t('away.reassigned', { count: data.reassigned }) });
        onChange();
      }
    } catch {
      setNote({ tone: 'error', text: t('errors.generic') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="sr-only" htmlFor="chat-away-status">
        {t('away.label')}
      </label>
      <select
        id="chat-away-status"
        className="select chat-compact-select chat-away-select"
        value={away ? 'away' : 'available'}
        disabled={busy}
        aria-describedby={note ? 'chat-away-note' : undefined}
        title={away ? t('away.awayHint') : undefined}
        onChange={(e) => void choose(e.target.value as Choice)}
      >
        <option value="available">{t('away.available')}</option>
        <option value="away">{t('away.away')}</option>
        {!away && <option value="awayReassign">{t('away.awayReassign')}</option>}
      </select>
      {note && (
        <p id="chat-away-note" className={note.tone === 'error' ? 'ui-error chat-away-note' : 'chat-away-note'} role="status">
          {note.text}
        </p>
      )}
    </>
  );
}
