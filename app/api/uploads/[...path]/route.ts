import { NextRequest } from 'next/server';
import { localUploadResponse } from '@/lib/upload-serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Subidas locales (self-host sin Blob). Viven en UPLOADS_DIR, fuera de
 * public/, y next.config reescribe /uploads/* acá antes de mirar archivos
 * estáticos: nunca se sirven sin estos headers.
 *
 * Solo las carpetas cuyas URLs ya son públicas por diseño (adjuntos de Chat,
 * Track, tareas del CRM y capturas de Robots). Docs, Notes, Board y media del
 * CRM pasan siempre por sus rutas con chequeo de permisos.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const { path } = await props.params;
  return localUploadResponse(path);
}
