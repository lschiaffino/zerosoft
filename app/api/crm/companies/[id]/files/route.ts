import { recordFilesHandlers } from '@/lib/crm-files-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Adjuntos de la empresa: GET lista, POST sube (multipart `file`), DELETE ?fileId=. */
export const { GET, POST, DELETE } = recordFilesHandlers('company');
