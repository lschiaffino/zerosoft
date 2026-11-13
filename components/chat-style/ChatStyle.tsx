'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_DISPLAY, displayCss, patchDisplay, type ChatDisplay } from '@/lib/chat-display';

export type ChatStyle = 'whatsapp' | 'zerosoft';

interface Ctx {
  style: ChatStyle;
  setStyle: (s: ChatStyle) => Promise<boolean>;
  /** Visualización de la persona (lib/chat-display.ts). */
  display: ChatDisplay;
  /** Cambia una o más opciones: se ve al instante y se guarda; si no se pudo guardar, vuelve atrás. */
  setDisplay: (patch: Partial<ChatDisplay>) => Promise<boolean>;
}

const ChatStyleContext = createContext<Ctx>({ style: 'whatsapp', setStyle: async () => false, display: DEFAULT_DISPLAY, setDisplay: async () => false });

/**
 * Estilo y visualización de los chats de WhatsApp (Inbox y Lines): los trae
 * el layout del servidor y se guardan por persona en /api/chat-style. El
 * estilo va en data-chat-style del contenedor (styles/groups-wa.css hace el
 * resto); la visualización, en un <style> propio (displayCss), así vale
 * también para lo que se abre en un portal y cambia sin recargar.
 */
export function ChatStyleProvider({ initial, initialDisplay = DEFAULT_DISPLAY, children }: { initial: ChatStyle; initialDisplay?: ChatDisplay; children: ReactNode }) {
  const [style, setLocal] = useState<ChatStyle>(initial);
  const [display, setDisplayLocal] = useState<ChatDisplay>(initialDisplay);
  // Lo último que se pidió guardar: si llega tarde la respuesta de un cambio anterior, no pisa uno más nuevo.
  const seq = useRef(0);
  const setStyle = useCallback(
    async (s: ChatStyle) => {
      const prev = style;
      setLocal(s);
      try {
        const res = await fetch('/api/chat-style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style: s }) });
        if (!res.ok) throw new Error('save');
        return true;
      } catch {
        setLocal(prev);
        return false;
      }
    },
    [style],
  );
  const setDisplay = useCallback(
    async (patch: Partial<ChatDisplay>) => {
      const prev = display;
      const next = patchDisplay(display, patch);
      const n = ++seq.current;
      setDisplayLocal(next);
      try {
        const res = await fetch('/api/chat-style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display: next }) });
        if (!res.ok) throw new Error('save');
        return true;
      } catch {
        if (n === seq.current) setDisplayLocal(prev);
        return false;
      }
    },
    [display],
  );
  const value = useMemo(() => ({ style, setStyle, display, setDisplay }), [style, setStyle, display, setDisplay]);
  const css = displayCss(display);
  return (
    <ChatStyleContext.Provider value={value}>
      {css && <style data-chat-display="">{css}</style>}
      {children}
    </ChatStyleContext.Provider>
  );
}

export function useChatStyle(): Ctx {
  return useContext(ChatStyleContext);
}

/** Solo la visualización (para componentes que no necesitan el estilo). */
export function useChatDisplay(): ChatDisplay {
  return useContext(ChatStyleContext).display;
}
