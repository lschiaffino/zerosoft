import { trackAttachmentRoutes } from '@/lib/track-attachment-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET (?download=1): el adjunto, solo para quien ve el issue. */
export const GET = trackAttachmentRoutes.file.GET;
