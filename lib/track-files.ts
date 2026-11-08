import { fileAttachments, isPrivateRef } from './file-attachments';

/**
 * Adjuntos de issues de Track (lib/file-attachments.ts): store privado
 * TRACK_BLOB_READ_WRITE_TOKEN o FILES_BLOB_READ_WRITE_TOKEN; en self-host,
 * disco local cifrado (UPLOADS_DIR/track-files).
 */
export const trackFiles = fileAttachments({ app: 'track', envPrefix: 'TRACK' });

/** Ruta autorizada que sirve un adjunto privado (las refs "blobp:"/"local:" no son URLs). */
export function trackAttachmentHref(issueId: string, attachmentId: string): string {
  return `/api/track/issues/${issueId}/attachments/${attachmentId}`;
}

/** La fila como la ve el cliente: los adjuntos privados apuntan a la ruta autorizada. */
export function presentTrackAttachment<T extends { id: string; issue_id: string; url: string }>(row: T): T {
  return isPrivateRef(row.url) ? { ...row, url: trackAttachmentHref(row.issue_id, row.id) } : row;
}
