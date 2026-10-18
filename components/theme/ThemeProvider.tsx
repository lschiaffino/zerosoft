'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { themeAttr, themeCookieString, type ThemePref } from '@/lib/color-theme';

interface ThemeCtx {
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
}

const ThemeContext = createContext<ThemeCtx>({ pref: 'system', setPref: () => {} });

/**
 * La preferencia de modo de color. El layout la lee de la cookie en el
 * servidor (así <html data-theme> llega bien en el primer render); al
 * cambiarla se reescribe la cookie y el atributo, sin recargar.
 */
export default function ThemeProvider({ initial, children }: { initial: ThemePref; children: ReactNode }) {
  const [pref, setState] = useState<ThemePref>(initial);

  const setPref = useCallback((next: ThemePref) => {
    setState(next);
    document.cookie = themeCookieString(next);
    const attr = themeAttr(next);
    const root = document.documentElement;
    if (attr) root.setAttribute('data-theme', attr);
    else root.removeAttribute('data-theme');
  }, []);

  const value = useMemo(() => ({ pref, setPref }), [pref, setPref]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePref(): ThemeCtx {
  return useContext(ThemeContext);
}

/**
 * El modo que se ve de verdad (system resuelto con prefers-color-scheme), para
 * lo que no se pinta con CSS (p. ej. el lienzo de Excalidraw). En el servidor
 * y el primer render, system cuenta como claro.
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const { pref } = useThemePref();
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemDark(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}
