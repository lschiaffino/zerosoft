/**
 * Secreto de los webhooks de WhatsApp (Inbox y Lines) en un header, no en la
 * ruta: la ruta queda en los logs de requests del hosting y quien la lea podía
 * mandar mensajes falsos a ese número. El servidor de WhatsApp (Evolution,
 * WAHA, el QR administrado) manda el header que se le registra con el webhook.
 *
 * - Ruta nueva: POST /api/{inbox|groups}/webhook/{id} con el header
 *   `x-zerosoft-webhook-secret`.
 * - Ruta vieja: /api/{inbox|groups}/webhook/{id}/{secreto}. Se sigue aceptando
 *   mientras haya instancias registradas con ella (se pasan solas al volver a
 *   vincular, o con el trabajo de mantenimiento `wa-webhook-header`). La Cloud
 *   API de Meta no deja mandar headers propios: esos números siguen con la ruta
 *   vieja (además Meta firma cada evento con X-Hub-Signature-256).
 */

export const WEBHOOK_SECRET_HEADER = 'x-zerosoft-webhook-secret';

/** Lo que se le registra al proveedor: la URL sin el secreto y el header que lo lleva. */
export interface WebhookTarget {
  url: string;
  headers: Record<string, string>;
}

/** El secreto del header (vacío si no vino). */
export function webhookSecretFromHeaders(headers: Headers): string {
  return (headers.get(WEBHOOK_SECRET_HEADER) ?? '').trim();
}

/** Destino con el secreto en el header. `base` sin barra final; `path` como "/api/inbox/webhook". */
export function headerWebhookTarget(base: string, path: string, id: string, secret: string): WebhookTarget {
  return { url: `${base}${path}/${encodeURIComponent(id)}`, headers: { [WEBHOOK_SECRET_HEADER]: secret } };
}

/** true si la URL registrada todavía lleva el secreto en la ruta (formato viejo). */
export function isLegacyWebhookUrl(url: string, secret: string): boolean {
  if (!secret) return false;
  try {
    return new URL(url).pathname.split('/').includes(secret);
  } catch {
    return false;
  }
}
