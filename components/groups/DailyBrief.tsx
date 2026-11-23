'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from './dialog-kit';
import { Close } from './wa/icons';
import type { BriefChat, BriefItem, BriefKind, BriefPayload } from '@/lib/daily-brief';

/** El día local de quien mira ("2026-11-23") y cuándo termina (la medianoche que viene): la tarjeta es por ese día. */
export function localDay(now = new Date()): { day: string; end: string } {
  const p = (n: number) => String(n).padStart(2, '0');
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { day: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`, end: end.toISOString() };
}

/** Cuánto queda a la vista "Oculto hasta mañana · Deshacer" después de cerrar. */
const UNDO_MS = 8000;
/** Al volver a la pestaña, se vuelve a pedir si pasó este rato (o si cambió el día). */
const STALE_MS = 5 * 60_000;
/**
 * Cuánto espera la lista de Lines a la tarjeta (se piden a la vez): así la tarjeta ya está cuando aparecen los chats
 * y no los corre hacia abajo al llegar (un clic iría a otro chat). Si tarda más, la lista no espera.
 */
const WAIT_MS = 3000;

/**
 * El estado de la tarjeta (lib/daily-brief.ts), en quien la muestra: así la
 * tarjeta puede cambiar de lugar (lista, vacío, tablero) sin volver a pedirla
 * ni perder el Deshacer. Cerrar y Deshacer van en fila (uno espera al otro),
 * así lo que queda en el servidor es lo último que se tocó. `initial`: la que
 * armó la página (Inbox), así está al pintar. `settled`: ya llegó (o no vale la
 * pena seguir esperándola) y la lista se puede mostrar sin que después se corra.
 */
export function useDailyBrief(endpoint: '/api/groups/brief' | '/api/inbox/brief', initial?: BriefPayload | null) {
  const [data, setData] = useState<BriefPayload | null>(initial ?? null);
  const [settled, setSettled] = useState(!!initial);
  const [state, setState] = useState<'shown' | 'undo' | 'hidden'>('shown');
  const [error, setError] = useState<'' | 'dismiss' | 'restore'>('');
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const first = useRef(initial);

  // Se pide al montar (si la página no la trajo para este día) y, al volver a la pestaña, de nuevo si cambió el día
  // o pasó un rato: la tarjeta vive en el layout y si no quedaría con las cuentas de la mañana (o con la de ayer).
  useEffect(() => {
    let live = true;
    let at = first.current ? Date.now() : 0;
    let shownDay = first.current?.day ?? '';
    const load = () => {
      const { day, end } = localDay();
      at = Date.now();
      void api<BriefPayload>(`${endpoint}?day=${day}&end=${encodeURIComponent(end)}`).then((res) => {
        if (!live) return;
        setSettled(true);
        if (!res.data) return;
        if (res.data.day !== shownDay) {
          // Otro día: lo cerrado ayer ya no cuenta.
          shownDay = res.data.day;
          setState('shown');
          setError('');
        }
        setData(res.data);
      });
    };
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      if (localDay().day !== shownDay || Date.now() - at > STALE_MS) load();
    };
    if (!first.current || first.current.day !== localDay().day) load();
    const wait = window.setTimeout(() => setSettled(true), WAIT_MS);
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      live = false;
      window.clearTimeout(wait);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  }, [endpoint]);

  useEffect(() => {
    if (state !== 'undo') return;
    const timer = window.setTimeout(() => setState('hidden'), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  /** Encola un pedido detrás del anterior. */
  const send = (body: Record<string, unknown>) => {
    const req = pending.current.then(() => api(endpoint, { method: 'POST', body }));
    pending.current = req.catch(() => undefined);
    return req;
  };
  const dismiss = async () => {
    if (!data) return;
    setError('');
    setState('undo');
    const res = await send({ action: 'dismiss', day: data.day });
    if (!res.data) {
      setState('shown');
      setError('dismiss');
    }
  };
  const undo = async () => {
    setError('');
    setState('shown');
    const res = await send({ action: 'restore' });
    if (!res.data) {
      setState('undo');
      setError('restore');
    }
  };
  return { data, settled, state, error, dismiss, undo };
}

export type DailyBriefState = ReturnType<typeof useDailyBrief>;

/**
 * Resumen del día arriba de la lista de Lines o de Inbox (lib/daily-brief.ts):
 * lo que espera a la persona hoy, en cuentas y con los primeros chats. Cada
 * fila lleva a lo suyo (`onOpen`). Se cierra por el día (vuelve mañana), con
 * Deshacer un rato, y avisa si el email de la mañana está prendido (Ajustes ›
 * Avisos). Si no hay nada pendiente, no aparece. En la lista va como primer
 * renglón (`as="li"`): cuando llega no mueve la caja de la lista; con la lista
 * vacía o el tablero, como bloque (`as="div"`).
 */
export default function DailyBrief({
  brief,
  as,
  onOpen,
}: {
  brief: DailyBriefState;
  as: 'li' | 'div';
  /** Abrir lo de una fila: la vista o el filtro que le corresponde, o el primer chat. */
  onOpen: (kind: BriefKind, chats: BriefChat[]) => void;
}) {
  const t = useTranslations('groups.wa.brief');
  const locale = useLocale();
  const titleId = useId();
  const { data, state, error, dismiss, undo } = brief;
  const item = (node: ReactNode) =>
    as === 'li' ? (
      <li className="wa-brief-li" role="presentation">
        {node}
      </li>
    ) : (
      <div className="wa-brief-block">{node}</div>
    );

  if (!data || data.dismissed || !data.brief || state === 'hidden') return null;
  const items = data.brief.items.filter((i) => i.count > 0);
  if (items.length === 0) return null;

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
