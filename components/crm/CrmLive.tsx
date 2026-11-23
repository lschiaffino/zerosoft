'use client';

import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useVisiblePoll } from '@/lib/use-visible-poll';
import type { CrmLiveEntity } from '@/lib/crm-live';

/** Cada cuánto pregunta una pantalla a la vista y con foco; sin foco, cada `UNFOCUSED_MS`. Oculta, nunca. */
export const CRM_LIVE_MS = 4_000;
const UNFOCUSED_MS = 20_000;

/**
 * ¿La persona está en medio de algo que una recarga le movería? Un campo con
 * el foco (una celda o propiedad en edición, la búsqueda), un menú o un
 * diálogo modal abierto, una card arrastrándose. Las casillas de selección y
 * los botones no cuentan: la selección se conserva igual. Pura sobre el DOM.
 */
export function crmIsBusy(doc: Document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (el && el !== doc.body) {
    const tag = el.tagName;
    const type = (el as HTMLInputElement).type;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
    if (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type)) return true;
  }
  return !!doc.querySelector('[role="menu"]:not([hidden]), [aria-modal="true"]:not([hidden]), dialog[open], .dragging, [data-crm-busy]');
}

/**
 * CRM en vivo (cliente). Pregunta cada pocos segundos si cambió algo de lo
 * que muestra la pantalla (lib/crm-live.ts) y, si cambió, pide la página de
 * nuevo con router.refresh: React conserva el estado de la pantalla (la
 * selección, el scroll, la vista previa abierta) y solo cambian los datos.
 * Si la persona está editando, la recarga espera a que termine.
 *
 * `rev` viene con la página: después de un refresh (propio o de otro) llega
 * el nuevo y no se vuelve a pedir lo mismo.
 */
export function useCrmLive({
  rev,
  entities = [],
  record = null,
}: {
  rev: number;
  entities?: CrmLiveEntity[];
  record?: { entity: CrmLiveEntity; id: string } | null;
}): { gone: boolean } {
  const router = useRouter();
  const known = useRef(rev);
  const pending = useRef(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (rev > known.current) known.current = rev;
  }, [rev]);

  const flush = useCallback(() => {
    if (!pending.current || crmIsBusy(document)) return;
    pending.current = false;
    startTransition(() => router.refresh());
  }, [router]);

  // Una recarga que esperaba sale cuando la persona termina (suelta el foco, cierra el menú, suelta la card).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = () => {
      if (!pending.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 300);
    };
    document.addEventListener('focusout', later);
    document.addEventListener('pointerup', later);
    document.addEventListener('keyup', later);
    // Un menú que se cierra sin mover el foco: se revisa cada tanto mientras haya algo pendiente.
    const id = setInterval(() => pending.current && flush(), 2_000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(id);
      document.removeEventListener('focusout', later);
      document.removeEventListener('pointerup', later);
      document.removeEventListener('keyup', later);
    };
  }, [flush]);

  const watch = entities.join(',');
  const recordKey = record ? `${record.entity}:${record.id}` : '';
  const inFlight = useRef(false);
  const check = useCallback(async () => {
    // Un servidor lento no junta pedidos: el próximo sale cuando vuelve el anterior.
    if (inFlight.current) return;
    inFlight.current = true;
    const params = new URLSearchParams({ since: String(known.current) });
    if (watch) params.set('w', watch);
    if (recordKey) params.set('r', recordKey);
    const res = await fetch(`/api/crm/live?${params}`, { cache: 'no-store' }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { rev: number; changed: boolean; gone: boolean } | null) : null;
    inFlight.current = false;
    if (!data) return;
    // Una base nueva (rev menor) vuelve a empezar desde su contador.
    known.current = data.rev < known.current ? data.rev : Math.max(known.current, data.rev);
    if (data.gone) {
      setGone(true);
      return;
    }
    if (data.changed) {
      pending.current = true;
      flush();
    }
  }, [watch, recordKey, flush]);

  useVisiblePoll(check, CRM_LIVE_MS, { enabled: !gone && (!!watch || !!recordKey), idleStart: true, unfocusedMs: UNFOCUSED_MS });
  return { gone };
}

/**
 * Montaje de useCrmLive en una página del CRM. En la ficha, si otra persona
 * borró el registro, en lugar de recargar a un 404 avisa y ofrece volver.
 */
export default function CrmLive({
  rev,
  entities,
  record,
  back,
}: {
  rev: number;
  entities?: CrmLiveEntity[];
  record?: { entity: CrmLiveEntity; id: string } | null;
  back?: { href: string; label: string };
}) {
  const t = useTranslations('crm');
  const { gone } = useCrmLive({ rev, entities, record });
  if (!gone) return null;
  return (
    <div className="crm-live-gone" role="status" data-testid="crm-live-gone">
      <span>{t('live.gone')}</span>
      {back && (
        <Link href={back.href} className="btn btn-secondary btn-sm">
          {t('live.backTo', { list: back.label })}
        </Link>
      )}
    </div>
  );
}
