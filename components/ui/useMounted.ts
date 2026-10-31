'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;
const onClient = () => true;
const onServer = () => false;

/**
 * false en el servidor y mientras se hidrata; true después, y de entrada en lo
 * que se monta más tarde (sin un render en blanco al navegar). Lo que depende de
 * la zona o el "ahora" del navegador se escribe recién ahí: el servidor no los
 * sabe y el texto no coincidiría al hidratar (error #418).
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
