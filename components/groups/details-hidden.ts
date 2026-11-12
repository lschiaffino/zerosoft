'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

const KEY = 'zs-lines-details-hidden';
const EVENT = 'zs:lines-details-hidden';
/** Desde este ancho el panel de detalles va al lado de la conversación (styles/groups.css). */
const WIDE = '(min-width: 1440px)';

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Panel de detalles de Lines en pantallas anchas: se puede esconder con el botón del encabezado
 * del chat, y queda así (por navegador) hasta que se vuelva a abrir. La bandeja (InboxShell) y la
 * conversación (ChatThread) comparten el estado por este hook. En pantallas más angostas el panel
 * es un cajón y no usa esto.
 */
export function useDetailsHidden(): { hidden: boolean; wide: boolean; setHidden: (hidden: boolean) => void } {
  const [hidden, setState] = useState(false);
  const [wide, setWide] = useState(true);
  useBrowserLayoutEffect(() => {
    setState(read());
    const mq = window.matchMedia(WIDE);
    setWide(mq.matches);
    const onChange = () => setState(read());
    const onMq = () => setWide(mq.matches);
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    mq.addEventListener('change', onMq);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
      mq.removeEventListener('change', onMq);
    };
  }, []);
  const setHidden = useCallback((next: boolean) => {
    try {
      if (next) window.localStorage.setItem(KEY, '1');
      else window.localStorage.removeItem(KEY);
    } catch {
      /* sin almacenamiento: vale para esta vista */
    }
    setState(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { hidden, wide, setHidden };
}
