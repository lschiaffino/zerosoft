'use client';

import { setRecScope } from './recStore';

/**
 * Fija de quién es la base de Rec del navegador (persona y workspace) antes
 * de que la usen las páginas: se llama en el render, que corre antes que los
 * efectos de los hijos. Idempotente.
 */
export default function RecScope({ userId, ws }: { userId: string; ws: string }) {
  setRecScope(userId, ws);
  return null;
}
