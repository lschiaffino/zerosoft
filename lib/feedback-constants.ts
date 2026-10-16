// Constantes de feedback sin dependencias de servidor (las usa el formulario cliente).

import { PRODUCT_KEYS, type ProductKey } from './product-taxonomy';

export { productFromPath } from './product-taxonomy';

export const FEEDBACK_KINDS = ['idea', 'bug', 'other'] as const;
/** Misma taxonomía que roadmap, board y changelog (lib/product-taxonomy.ts). */
export const FEEDBACK_PRODUCTS = PRODUCT_KEYS;
export const FEEDBACK_STATUSES = ['new', 'read', 'done'] as const;
export const FEEDBACK_MAX = 4000;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackProduct = ProductKey;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
