import { trackAttachmentRoutes } from '@/lib/track-attachment-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET: modo de almacenamiento y prefijo. POST: token de subida directa a
 * Blob privado, o el archivo en el cuerpo en modo local (lib/file-attachments.ts).
 */
export const GET = trackAttachmentRoutes.upload.GET;
export const POST = trackAttachmentRoutes.upload.POST;
