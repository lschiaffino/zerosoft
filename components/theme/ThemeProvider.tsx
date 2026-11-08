'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { themeAttr, themeCookieString, themePrefFromDocument, type ThemePref } from '@/lib/color-theme';

interface ThemeCtx {
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
}

const THEME_EVENT = 'zs:theme-pref';

const ThemeContext = createContext<ThemeCtx>({ pref: 'system', setPref: () => {} });

/**
 * La preferencia de modo de color; al cambiarla se reescribe la cookie y el
 * atributo, sin recargar. <html data-theme> lo pone THEME_INIT_SCRIPT antes
 * del primer paint. Sin `initial` (el sitio, que es HTML estático) la
 * preferencia se lee de la cookie al montar; la app la pasa desde el
 * servidor, así el selector y lo que depende del modo ya llegan bien.
 */
export default function ThemeProvider({ initial, children }: { initial?: ThemePref; children: ReactNode }) {
  const [pref, setState] = useState<ThemePref>(initial ?? 'system');

  useEffect(() => {
    if (initial === undefined) setState(themePrefFromDocument());
    // El sitio y la app tienen cada uno su provider: el cambio en uno se ve en el otro.
    const onChange = (e: Event) => setState((e as CustomEvent<ThemePref>).detail);
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, [initial]);

  const setPref = useCallback((next: ThemePref) => {
    setState(next);
    document.cookie = themeCookieString(next);
    const attr = themeAttr(next);
    const root = document.documentElement;
    if (attr) root.setAttribute('data-theme', attr);
    else root.removeAttribute('data-theme');
    window.dispatchEvent(new CustomEvent<ThemePref>(THEME_EVENT, { detail: next }));
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
