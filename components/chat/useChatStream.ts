'use client';

import { useEffect, useRef } from 'react';

type Listener = { conversationId: string | null; fn: () => void };

/**
 * Una sola conexión SSE por pestaña, compartida por la lista y la conversación
 * abierta. Con la pestaña oculta se cierra y al volver reengancha desde el
 * último evento visto. Al reconectar avisa a todos para releer.
 */
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let cursor = 0;
let connectedOnce = false;
let live = false;
let watching = false;

function fireAll() {
  for (const l of listeners) l.fn();
}

function open() {
  if (es || typeof EventSource === 'undefined' || listeners.size === 0 || document.visibilityState !== 'visible') return;
  es = new EventSource(`/api/chat/stream${cursor ? `?cursor=${cursor}` : ''}`);
  es.addEventListener('ready', () => {
    live = true;
    if (connectedOnce) fireAll();
    connectedOnce = true;
  });
  es.addEventListener('events', (e) => {
    const data = JSON.parse((e as MessageEvent<string>).data) as { events: Array<{ conversationId: string }>; cursor: number };
    cursor = Math.max(cursor, data.cursor);
    const ids = new Set(data.events.map((x) => x.conversationId));
    for (const l of listeners) if (!l.conversationId || ids.has(l.conversationId)) l.fn();
  });
  es.addEventListener('reset', () => fireAll());
  es.addEventListener('bye', (e) => {
    const reason = (JSON.parse((e as MessageEvent<string>).data) as { reason?: string }).reason;
    if (reason === 'revoked') close();
  });
  es.onerror = () => {
    live = false;
  };
}

function close() {
  es?.close();
  es = null;
  live = false;
}

function onVisibility() {
  if (document.visibilityState === 'visible') open();
  else close();
}

/** onChange corre cuando cambió esa conversación (o cualquiera, con null). `live` dice si el stream está conectado. */
export function useChatStream(conversationId: string | null, onChange: () => void) {
  const handler = useRef(onChange);
  handler.current = onChange;
  const state = useRef({ get current() { return live; } });
  useEffect(() => {
    const entry: Listener = { conversationId, fn: () => handler.current() };
    listeners.add(entry);
    if (!watching) {
      watching = true;
      document.addEventListener('visibilitychange', onVisibility);
    }
    open();
    return () => {
      listeners.delete(entry);
      if (listeners.size === 0) {
        close();
        connectedOnce = false;
      }
    };
  }, [conversationId]);
  return state.current;
}
