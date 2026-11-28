'use client';

import { useCrmLive } from './useCrmLive';

/**
 * Para listas que se arman en el servidor (la tabla de leads): sondea la firma
 * de las filas que hay en pantalla y recarga la página cuando un compañero
 * cambia algo que esta persona ve. No dibuja nada.
 */
export default function CrmLiveList({ list, ids }: { list: 'leads'; ids: string[] }) {
  useCrmLive({ list, ids });
  return null;
}
