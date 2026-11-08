/**
 * Qué figura lleva cada página. Una figura se nombra por su familia (un archivo
 * de ./figures, que se carga aparte) y su variante.
 */

import type { ProductKey } from '@/lib/products';

export type FigureFamily = 'board' | 'chain' | 'chart' | 'days' | 'field' | 'graph' | 'notfound' | 'paper' | 'shapes' | 'sketch';
export type FigureRef = readonly [family: FigureFamily, variant: string];

/** La figura del primer viewport de cada app: lo que la app hace, dibujado con ceros. */
export const PRODUCT_FIGURES: Record<ProductKey, FigureRef> = {
  link: ['chain', ''],
  crm: ['board', 'crm'],
  chat: ['paper', 'chat'],
  groups: ['paper', 'groups'],
  agents: ['graph', 'agents'],
  flow: ['graph', 'flow'],
  robots: ['paper', 'robots'],
  track: ['board', 'track'],
  docs: ['paper', 'docs'],
  notes: ['paper', 'notes'],
  cal: ['days', 'cal'],
  board: ['sketch', 'board'],
  voice: ['chart', 'wave'],
  rec: ['paper', 'rec'],
  talk: ['paper', 'talk'],
  design: ['shapes', 'design'],
  shop: ['shapes', 'shop'],
  pulse: ['chart', 'bars'],
  analytics: ['chart', 'bars'],
  social: ['days', 'social'],
  hiring: ['board', 'hiring'],
  people: ['days', 'people'],
  books: ['paper', 'books'],
  sign: ['sketch', 'sign'],
  forms: ['paper', 'forms'],
  send: ['paper', 'send'],
};
