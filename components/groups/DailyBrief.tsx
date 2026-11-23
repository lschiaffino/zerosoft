'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from './dialog-kit';
import { Close } from './wa/icons';
import type { BriefChat, BriefItem, BriefKind, DailyBrief as Brief } from '@/lib/daily-brief';

/** El día local de quien mira ("2026-11-23") y cuándo termina (la medianoche que viene): la tarjeta es por ese día. */
export function localDay(now = new Date()): { day: string; end: string } {
  const p = (n: number) => String(n).padStart(2, '0');
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { day: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`, end: end.toISOString() };
}

interface Payload {
  day: string;
  dismissed: boolean;
  email: boolean;
  brief: Brief | null;
}

/** Cuánto queda a la vista "Oculto hasta mañana · Deshacer" después de cerrar. */
const UNDO_MS = 8000;

/**
 * Resumen del día arriba de la lista de Lines o de Inbox (lib/daily-brief.ts):
 * lo que espera a la persona hoy, en cuentas y con los primeros chats. Cada
 * fila lleva a lo suyo (`onOpen`). Se cierra por el día (vuelve mañana), con
 * Deshacer un rato, y avisa si el email de la mañana está prendido (Ajustes ›
 * Avisos). Si no hay nada pendiente, no aparece. Va como primer renglón de la
 * lista (un <li>): cuando llega no mueve la caja de la lista.
 */
export default function DailyBrief({
  endpoint,
  onOpen,
}: {
  endpoint: '/api/groups/brief' | '/api/inbox/brief';
  /** Abrir lo de una fila: la vista o el filtro que le corresponde, o el primer chat. */
  onOpen: (kind: BriefKind, chats: BriefChat[]) => void;
}) {
  const item = (node: ReactNode) => (
    <li className="wa-brief-li" role="presentation">
      {node}
    </li>
  );
  const t = useTranslations('groups.wa.brief');
  const locale = useLocale();
  const titleId = useId();
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<'shown' | 'undo' | 'hidden'>('shown');
  const [error, setError] = useState<'' | 'dismiss' | 'restore'>('');
  // El cierre en curso: Deshacer espera a que termine, así el servidor no queda cerrado con la tarjeta a la vista.
  const dismissing = useRef<Promise<unknown> | null>(null);

  const load = useCallback(async () => {
    const { day, end } = localDay();
    const res = await api<Payload>(`${endpoint}?day=${day}&end=${encodeURIComponent(end)}`);
    if (res.data) setData(res.data);
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state !== 'undo') return;
    const timer = window.setTimeout(() => setState('hidden'), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (!data || data.dismissed || !data.brief || state === 'hidden') return null;
  const items = data.brief.items.filter((i) => i.count > 0);
  if (items.length === 0) return null;

  const dismiss = async () => {
    setError('');
    setState('undo');
    const req = api(endpoint, { method: 'POST', body: { action: 'dismiss', day: data.day } });
    dismissing.current = req;
    const res = await req;
    if (!res.data) {
      setState('shown');
      setError('dismiss');
    }
  };
  const undo = async () => {
    await dismissing.current;
    setState('shown');
    const res = await api(endpoint, { method: 'POST', body: { action: 'restore' } });
    if (!res.data) {
      setState('undo');
      setError('restore');
    }
  };

  if (state === 'undo')
    return item(
      <div className="wa-brief wa-brief-undo" role="status" data-testid="daily-brief-undo">
        <span>{error === 'restore' ? t('restoreError') : t('hidden')}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void undo()}>
          {t('undo')}
        </button>
      </div>,
    );

  const day = new Date(`${data.day}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const names = (i: BriefItem) => {
    const list = i.chats.map((c) => c.name || t('unnamed')).join(', ');
    const more = i.chatTotal - i.chats.length;
    return more > 0 ? t('andMore', { list, n: more }) : list;
  };

  return item(
    <section className="wa-brief" aria-labelledby={titleId} data-testid="daily-brief" data-app={data.brief.app}>
      <div className="wa-brief-head">
        <h2 className="wa-brief-title" id={titleId}>
          {t('title')}
        </h2>
        <span className="wa-brief-date">{day}</span>
        <button type="button" className="wa-icon-btn wa-brief-close" aria-label={t('dismiss')} title={t('dismiss')} onClick={() => void dismiss()} data-testid="daily-brief-dismiss">
          <Close size={18} />
        </button>
      </div>
      {error === 'dismiss' && (
        <p className="ui-error" role="alert">
          {t('dismissError')}
        </p>
      )}
      <ul className="wa-brief-list">
        {items.map((i) => (
          <li key={i.kind}>
            <button type="button" className="wa-brief-row" data-kind={i.kind} data-testid="daily-brief-item" onClick={() => onOpen(i.kind, i.chats)}>
              <span className="wa-brief-count">{i.count}</span>
              <span className="wa-brief-text">
                <span className="wa-brief-label">{t(`kind.${i.kind}`, { n: i.count })}</span>
                {i.chats.length > 0 && <span className="wa-brief-chats">{names(i)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="wa-brief-foot">
        <Link href="/app/settings/notifications#daily-brief" prefetch={false}>
          {data.email ? t('emailOn') : t('emailOff')}
        </Link>
      </p>
    </section>,
  );
}
