import { NextRequest } from 'next/server';
import { localUploadResponse } from '@/lib/upload-serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Subidas locales (self-host sin Blob). Viven en UPLOADS_DIR, fuera de
 * public/, y next.config reescribe /uploads/* acá antes de mirar archivos
 * estáticos: nunca se sirven sin estos headers.
 *
 * Solo las carpetas públicas por diseño (logos, tienda, redes). Los
 * adjuntos de antes (Chat, Track, tareas del CRM, Robots) solo si la
 * migración los registró, con sesión y permiso. Docs, Notes, Board y media
 * del CRM pasan siempre por sus rutas con chequeo de permisos.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const { path } = await props.params;
  return localUploadResponse(path, req);
}
