'use client';

import Script from 'next/script';
import { useEffect } from 'react';

type ZsWindow = Window & {
  zsChatSettings?: { email?: string | null; name?: string | null };
  zsChat?: { identify?: (o: { email?: string | null; name?: string | null }) => void };
};

function setWidgetVisible(visible: boolean) {
  const root = document.getElementById('zs-chat-root');
  if (root) root.style.display = visible ? '' : 'none';
}

/**
 * Widget de soporte propio: el mismo embed de Chat que usan los clientes
 * (/api/chat/widget.js), apuntando al widget SUPPORT_WIDGET_ID. Se carga una
 * sola vez; al salir de las páginas donde corresponde se oculta.
 */
export default function SupportWidget({ widgetId }: { widgetId: string }) {
  useEffect(() => {
    setWidgetVisible(true);
    return () => setWidgetVisible(false);
  }, []);
  return (
    <Script
      id="zs-support-widget"
      src={`/api/chat/widget.js?id=${encodeURIComponent(widgetId)}`}
      strategy="lazyOnload"
    />
  );
}

/** Pasa al widget el email y nombre de la persona logueada (app). */
export function SupportIdentify({ email, name }: { email: string | null; name: string | null }) {
  useEffect(() => {
    const w = window as ZsWindow;
    w.zsChatSettings = { email, name };
    w.zsChat?.identify?.({ email, name });
  }, [email, name]);
  return null;
}
