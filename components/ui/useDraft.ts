'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { draftsVersion, forgetDraft, knownDraft, localDraft, pickDraft, savedDraft, settled, subscribeDrafts, typeDraft } from '@/lib/draft-store';

/**
 * El borrador de un chat para mostrar en su fila (lib/draft-store.ts): lo que
 * se acaba de escribir en el composer, o el del servidor cuando ya coinciden.
 */
export function useDraft(scope: string, id: string, server: string): string {
  useSyncExternalStore(subscribeDrafts, draftsVersion, draftsVersion);
  const local = localDraft(scope, id);
  const shown = pickDraft(local, server, Date.now());
  // Cuando el servidor ya lo tiene, lo local se suelta (sin cambiar lo que se ve).
  useEffect(() => {
    if (local && settled(local, server, Date.now())) forgetDraft(scope, id);
  }, [local, server, scope, id]);
  return shown;
}

/** El borrador con el que abre el composer de un chat: lo local si hay algo más nuevo que lo del servidor. */
export function initialDraft(scope: string, id: string, server: string): string {
  return pickDraft(localDraft(scope, id), server, Date.now());
}

/**
 * Guarda solo el borrador de un composer: cada cambio llega a la lista al
 * instante (typeDraft) y se guarda en el servidor `delay` ms después de
 * dejar de escribir. Al cambiar de chat o cerrar, lo que faltaba guardar se
 * guarda en el momento, también al cerrar o recargar la página (pedido con
 * keepalive); antes se perdía lo escrito en el último medio segundo. Con `paused` (editando un mensaje) no toca el borrador.
 *
 * Un composer por chat: quien lo usa lo monta con `key={id}`.
 */
export function useDraftAutosave(o: { scope: string; id: string; text: string; saved: { current: string }; paused?: boolean; save: (id: string, text: string) => Promise<boolean>; delay?: number }) {
  const { scope, id, text, saved, paused, save } = o;
  const delay = o.delay ?? 700;
  // Lo último que se vio, para guardarlo al irse (se actualiza después de cada render, no durante).
  const latest = useRef({ text, paused: !!paused });
  useEffect(() => {
    latest.current = { text, paused: !!paused };
  });
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  const persist = useCallback(
    (chat: string, value: string) => {
      saved.current = value;
      void saveRef.current(chat, value).then((ok) => {
        if (ok) savedDraft(scope, chat, value);
      });
    },
    [scope, saved],
  );

  // Cada tecla: la fila de la lista ya lo muestra.
  const timer = useRef(0);
  useEffect(() => {
    if (paused || text === saved.current) return;
    typeDraft(scope, id, text);
    timer.current = window.setTimeout(() => persist(id, text), delay);
    return () => window.clearTimeout(timer.current);
  }, [text, id, paused, scope, delay, persist, saved]);

  // Otro chat, el composer se va, o la página se cierra o se recarga: lo pendiente se guarda ya.
  useEffect(() => {
    const flush = () => {
      const l = latest.current;
      if (!l.paused && l.text !== saved.current) persist(id, l.text);
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      flush();
    };
  }, [id, persist, saved]);

  /**
   * Se manda el mensaje: el borrador sale de la fila ya (como WhatsApp) y el
   * guardado pendiente no se manda (llegaría después y dejaría un borrador
   * fantasma). Si el envío falla, `failed()` vuelve a mostrarlo.
   */
  const sending = useCallback(() => {
    window.clearTimeout(timer.current);
    saved.current = latest.current.text;
    knownDraft(scope, id, '');
  }, [scope, id, saved]);
  const failed = useCallback(
    (value: string) => {
      saved.current = '';
      typeDraft(scope, id, value);
      persist(id, value);
    },
    [scope, id, saved, persist],
  );
  return { sending, failed };
}
