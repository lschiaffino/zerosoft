'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type RefObject } from 'react';
import { followAfterScroll, followDecision, isNearBottom } from '@/lib/assistant/scroll';

/**
 * Lo que agranda un mensaje a pedido de la persona (una lista que se abre,
 * "Mostrar las 27") llama a esto antes: la charla no salta al final.
 */
export const HoldScrollContext = createContext<() => void>(() => {});
export const useHoldScroll = () => useContext(HoldScrollContext);

/**
 * Scroll de la charla (lib/assistant/scroll.ts): al abrirla queda en el último
 * mensaje; lo que llega se sigue solo si estabas al final; si subiste a leer,
 * no te mueve y aparece "Ir al final".
 */
export function useFollow(listRef: RefObject<HTMLDivElement | null>, ready: boolean) {
  const following = useRef(true);
  const holding = useRef(false);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !ready) return;
    const onChange = () => {
      const d = followDecision({ following: following.current, holding: holding.current, nearBottom: isNearBottom(el) });
      if (d.action === 'follow') el.scrollTop = el.scrollHeight;
      setShowJump(d.jump);
    };
    let lastTop = el.scrollTop;
    const onScroll = () => {
      const scrolledUp = el.scrollTop < lastTop - 1;
      lastTop = el.scrollTop;
      if (holding.current) return;
      const near = isNearBottom(el);
      following.current = followAfterScroll({ scrolledUp, nearBottom: near });
      setShowJump(!near);
    };
    onChange();
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onChange);
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    // El alto de la charla cambia (el campo crece, se abre el teclado): si estabas al final, seguís ahí.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onChange);
    ro?.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    // Abrir un bloque plegado (los pasos, el razonamiento) agranda el mensaje sin tocar el DOM: tampoco salta.
    const onToggle = () => {
      following.current = false;
      requestAnimationFrame(() => {
        const near = isNearBottom(el);
        following.current = near;
        setShowJump(!near);
      });
    };
    el.addEventListener('toggle', onToggle, true);
    return () => {
      el.removeEventListener('toggle', onToggle, true);
      mo?.disconnect();
      ro?.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [listRef, ready]);

  /** Antes de abrir algo adentro de un mensaje: no seguir hasta que se acomode. */
  const hold = useCallback(() => {
    holding.current = true;
    following.current = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        holding.current = false;
        const el = listRef.current;
        if (!el) return;
        const near = isNearBottom(el);
        following.current = near;
        setShowJump(!near);
      }),
    );
  }, [listRef]);

  /** Al mandar un mensaje o tocar "Ir al final": al final, y desde ahí se sigue. */
  const follow = useCallback(() => {
    following.current = true;
    setShowJump(false);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [listRef]);

  return { hold, follow, showJump };
}
