'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from './dialog-kit';
import { Close } from './wa/icons';
import type { BriefChat, BriefItem, BriefKind, DailyBrief as Brief } from '@/lib/daily-brief';

/** El día local de quien mira ("2026-11-23"): la tarjeta se cierra por ese día. */
export function localDay(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

interface Payload {
  day: string;
  dismissed: boolean;
  email: boolean;
  brief: Brief;
}

/**
 * Resumen del día arriba de la lista de Lines o de Inbox (lib/daily-brief.ts):
 * lo que espera a la persona hoy, en cuentas y con los primeros chats. Cada
 * fila lleva a lo suyo (`onOpen`). Se cierra por el día (vuelve mañana) y
 * avisa si el email de la mañana está prendido (Ajustes › Avisos). Si no hay
 * nada que mostrar, ni aparece.
 */
export default function DailyBrief({
  endpoint,
  onOpen,
}: {
  endpoint: '/api/groups/brief' | '/api/inbox/brief';
  /** Abrir lo de una fila: la vista o el filtro que le corresponde, o el primer chat. */
  onOpen: (kind: BriefKind, chats: BriefChat[]) => void;
}) {
  const t = useTranslations('groups.wa.brief');
  const locale = useLocale();
  const titleId = useId();
  const [data, setData] = useState<Payload | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    const res = await api<Payload>(`${endpoint}?day=${localDay()}`);
    if (res.data) setData(res.data);
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data || data.dismissed || hidden) return null;
  const items = data.brief.items.filter((i) => i.count > 0);
  const day = new Date(`${data.day}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  const dismiss = async () => {
    setHidden(true);
    const res = await api(endpoint, { method: 'POST', body: { action: 'dismiss', day: data.day } });
    if (!res.data) setHidden(false);
  };

  const names = (i: BriefItem) => {
    const list = i.chats.map((c) => c.name || t('unnamed')).join(', ');
    const more = i.count - i.chats.length;
    return more > 0 && i.chats.length > 0 ? t('andMore', { list, n: more }) : list;
  };

  return (
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
      {items.length === 0 ? (
        <p className="wa-brief-empty" data-testid="daily-brief-empty">
          {t('empty')}
        </p>
      ) : (
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
      )}
      <p className="wa-brief-foot">
        <Link href="/app/settings/notifications#daily-brief" prefetch={false}>
          {data.email ? t('emailOn') : t('emailOff')}
        </Link>
      </p>
    </section>
  );
}
