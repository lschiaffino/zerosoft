'use client';

import { useEffect, useRef } from 'react';
import { CMDK_CONTEXT_EVENT, setCommandContext, type CommandAction } from '@/lib/cmdk-context';
import { slashToCommandActions, type SlashCmdkOptions } from '@/lib/slash-cmdk';
import type { SlashCommand } from '@/lib/slash-commands';

/**
 * Registra las acciones del chat abierto (Lines e Inbox) en la paleta ⌘K
 * mientras el chat está montado. La paleta consulta el proveedor al abrirse y
 * en cada render, y el proveedor lee lo último de una ref: las acciones nunca
 * quedan con el estado de un render viejo (fijado, silenciado, la etiqueta
 * puesta). Cuando cambian (fijar pasa a soltar), se avisa a la paleta por si
 * está abierta.
 */
export function useChatCommands(title: string, commands: SlashCommand[], opts: SlashCmdkOptions, extra: CommandAction[] = []) {
  const latest = useRef({ title, commands, opts, extra });
  latest.current = { title, commands, opts, extra };
  useEffect(
    () =>
      setCommandContext(() => {
        const cur = latest.current;
        return { title: cur.title, actions: [...cur.extra, ...slashToCommandActions(cur.commands, cur.opts)] };
      }),
    [],
  );
  const signature = `${title}\n${commands.map((c) => c.id).join(' ')}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.dispatchEvent(new Event(CMDK_CONTEXT_EVENT));
  }, [signature]);
}
