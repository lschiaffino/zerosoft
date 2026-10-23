import type { ProductKey } from '@/lib/products';
import type { ProductParity } from './types';
import agents from './agents';
import board from './board';
import cal from './cal';
import chat from './chat';
import crm from './crm';
import docs from './docs';
import flow from './flow';
import link from './link';
import notes from './notes';
import robots from './robots';
import track from './track';

/**
 * Paridad de cada app contra su competidor principal. Al sumar o quitar una
 * capacidad, se actualiza el archivo del producto (status y lastReviewed) y
 * el porcentaje de la página cambia solo.
 */
export const PARITY: Record<ProductKey, ProductParity> = {
  crm,
  chat,
  agents,
  flow,
  robots,
  track,
  link,
  docs,
  notes,
  cal,
  board,
};

export type { ProductParity, ParityRow, ParityStatus, ParityArea, Localized } from './types';
