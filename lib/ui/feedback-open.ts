/**
 * Abrir el panel de feedback (components/FeedbackLauncher.tsx) desde otro lado, por ejemplo el menú de la cuenta:
 * en el teléfono la pestaña flotante no se muestra sobre el chat de Lines e Inbox.
 */
export const FEEDBACK_OPEN_EVENT = 'zs:feedback-open';

export function openFeedback() {
  window.dispatchEvent(new Event(FEEDBACK_OPEN_EVENT));
}
