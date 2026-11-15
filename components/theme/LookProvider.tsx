'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOOK, SITE_LOOK, lookCookieString, lookFromDocument, type Look } from '@/lib/look';

interface LookCtx {
  look: Look;
  /** Aplica el aspecto al momento y lo guarda en la cuenta. Resuelve false si no se pudo guardar. */
  setLook: (look: Look) => Promise<boolean>;
}

const LOOK_EVENT = 'zs:look';

const LookContext = createContext<LookCtx>({ look: DEFAULT_LOOK, setLook: async () => false });

/** Pone el aspecto en <html data-look> y en la cookie, sin recargar. */
export function applyLook(look: Look): void {
  document.documentElement.setAttribute('data-look', look);
  document.cookie = lookCookieString(look);
  window.dispatchEvent(new CustomEvent<Look>(LOOK_EVENT, { detail: look }));
}

/**
 * El aspecto de la interfaz (lib/look.ts). <html data-look> lo ponen
 * LOOK_INIT_SCRIPT (cookie) y, en la app, lookSyncScript (users.look) antes
 * del primer paint; acá solo se cambia y se guarda.
 */
export default function LookProvider({ initial, children }: { initial?: Look; children: ReactNode }) {
  const [look, setState] = useState<Look>(initial ?? DEFAULT_LOOK);

  useEffect(() => {
    if (initial === undefined) setState(lookFromDocument());
    const onChange = (e: Event) => setState((e as CustomEvent<Look>).detail);
    window.addEventListener(LOOK_EVENT, onChange);
    return () => window.removeEventListener(LOOK_EVENT, onChange);
  }, [initial]);

  // Entrar a la app con una navegación del cliente (desde el sitio) no corre el script del
  // layout: el atributo se pone acá. Al salir de la app, el sitio vuelve a SITE_LOOK.
  useEffect(() => {
    if (initial === undefined) return;
    const root = document.documentElement;
    if (root.getAttribute('data-look') !== initial) root.setAttribute('data-look', initial);
    return () => root.setAttribute('data-look', SITE_LOOK);
  }, [initial]);

  const setLook = useCallback(async (next: Look) => {
    setState(next);
    applyLook(next);
    try {
      const res = await fetch('/api/profile/look', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ look: next }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo(() => ({ look, setLook }), [look, setLook]);
  return <LookContext.Provider value={value}>{children}</LookContext.Provider>;
}

export function useLook(): LookCtx {
  return useContext(LookContext);
}
