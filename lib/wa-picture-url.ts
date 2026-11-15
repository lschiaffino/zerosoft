/**
 * URL para el navegador de la foto de un contacto de WhatsApp (Inbox o
 * Lines): nuestra ruta, nunca la de la CDN de WhatsApp. Puro.
 */
export function contactPicture(app: 'inbox' | 'groups', contactId: string, raw: string | null | undefined): string {
  if (!raw) return '';
  // Lo que ya es nuestro (relativo) va igual; la CDN de WhatsApp, por la ruta del contacto.
  if (raw.startsWith('/')) return raw;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `/api/${app}/contacts/${encodeURIComponent(contactId)}/picture?v=${(h >>> 0).toString(36)}`;
}
