import { trackAttachmentRoutes } from '@/lib/track-attachment-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { pathname, filename }: registra un archivo ya subido a Blob privado. */
export const POST = trackAttachmentRoutes.finalize.POST;
