'use client';

import Script from 'next/script';
import { useEffect } from 'react';

type ZsIdentity = { email?: string | null; name?: string | null; userHash?: string | null };

type ZsWindow = Window & {
  zsChatSettings?: ZsIdentity;
  zsChat?: { identify?: (o: ZsIdentity) => void };
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

/**
 * Pasa al widget el email y nombre de la persona logueada (app). userHash es la
 * firma HMAC del email hecha en el server (lib/chat-identity.ts): con ella el
 * inbox de soporte ve el email como verificado. El secreto nunca llega acá.
 */
export function SupportIdentify({
  email,
  name,
  userHash = null,
}: {
  email: string | null;
  name: string | null;
  userHash?: string | null;
}) {
  useEffect(() => {
    const w = window as ZsWindow;
    w.zsChatSettings = { email, name, userHash };
    w.zsChat?.identify?.({ email, name, userHash });
  }, [email, name, userHash]);
  return null;
}
