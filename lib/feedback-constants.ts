// Constantes de feedback sin dependencias de servidor (las usa el formulario cliente).

export const FEEDBACK_KINDS = ['idea', 'bug', 'other'] as const;
export const FEEDBACK_PRODUCTS = ['link', 'crm', 'cal', 'track', 'chat', 'docs', 'flow', 'agents', 'notes', 'board', 'site', 'other'] as const;
export const FEEDBACK_STATUSES = ['new', 'read', 'done'] as const;
export const FEEDBACK_MAX = 4000;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackProduct = (typeof FEEDBACK_PRODUCTS)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Producto a partir de la ruta de la app (/app/crm/... → crm). */
export function productFromPath(pathname: string): FeedbackProduct {
  const m = /^(?:\/(?:en|es|pt))?\/app(?:\/([a-z]+))?(?:\/|$)/.exec(pathname);
  if (!m) return 'site';
  switch (m[1]) {
    case 'crm':
      return 'crm';
    case 'calendar':
      return 'cal';
    case 'track':
      return 'track';
    case 'chat':
      return 'chat';
    case 'docs':
      return 'docs';
    case 'flow':
      return 'flow';
    case 'notes':
      return 'notes';
    case 'board':
      return 'board';
    case 'agents':
      return 'agents';
    default:
      return 'link';
  }
}
