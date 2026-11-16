'use client';

import { useSyncExternalStore } from 'react';
import { useMediaQuery } from './wa/backLayer';

/**
 * El panel de HubSpot fijado al costado del chat, igual en Lines y en Inbox:
 * se guarda en este dispositivo (como el asistente fijado) y vale para todos
 * los chats: al cambiar de chat el panel sigue abierto y muestra el nuevo.
 * Solo en pantallas de 1024px o más; en el teléfono el panel es una hoja.
 */
const KEY = 'zs.hubspot.panel';
const EVENT = 'zs:hubspot-panel';
export const HUBSPOT_DOCK_QUERY = '(min-width: 1024px)';

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'pinned';
  } catch {
    return false;
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function setHubspotPanelPinned(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(KEY, 'pinned');
    else window.localStorage.removeItem(KEY);
  } catch {
    // Sin almacenamiento (modo privado estricto): vale hasta recargar.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Si el panel está fijado y la pantalla da para tenerlo al costado. */
export function useHubspotDocked(): boolean {
  const pinned = useSyncExternalStore(subscribe, read, () => false);
  const wide = useMediaQuery(HUBSPOT_DOCK_QUERY);
  return pinned && wide;
}
