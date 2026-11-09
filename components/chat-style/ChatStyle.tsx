'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ChatStyle = 'whatsapp' | 'zerosoft';

interface Ctx {
  style: ChatStyle;
  setStyle: (s: ChatStyle) => Promise<boolean>;
}

const ChatStyleContext = createContext<Ctx>({ style: 'whatsapp', setStyle: async () => false });

/**
 * Estilo de los chats de WhatsApp (Inbox y Lines): lo trae el layout del
 * servidor y se guarda por persona en /api/chat-style. La pantalla lo pone en
 * data-chat-style del contenedor; el CSS (styles/groups-wa.css) hace el resto.
 */
export function ChatStyleProvider({ initial, children }: { initial: ChatStyle; children: ReactNode }) {
  const [style, setLocal] = useState<ChatStyle>(initial);
  const setStyle = useCallback(async (s: ChatStyle) => {
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
  }, [style]);
  const value = useMemo(() => ({ style, setStyle }), [style, setStyle]);
  return <ChatStyleContext.Provider value={value}>{children}</ChatStyleContext.Provider>;
}

export function useChatStyle(): Ctx {
  return useContext(ChatStyleContext);
}
