/** Eventos de webhooks salientes (puro: lo usan el servidor y la UI de Ajustes). */
export const WEBHOOK_EVENTS = [
  'booking.created',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.no_show',
  'booking.requested',
  'link.created',
  'link.clicked',
  'contact.created',
  'contact.updated',
  'deal.created',
  'deal.updated',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'robot.run.finished',
  'robot.run.failed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
