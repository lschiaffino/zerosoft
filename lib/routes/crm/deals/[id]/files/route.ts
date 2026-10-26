import { recordFilesHandlers } from '@/lib/crm-files-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Adjuntos del deal: GET lista, POST sube (multipart `file`), DELETE ?fileId=. */
export const { GET, POST, DELETE } = recordFilesHandlers('deal');
