import { NextRequest } from 'next/server';
import { localUploadResponse } from '@/lib/upload-serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sin Blob (self-host) los archivos van a public/uploads, pero `next start`
 * solo sirve lo que estaba en public/ al hacer el build: lo subido después
 * daba 404. Esta ruta lo sirve desde el disco (en dev Next lo sirve antes
 * como archivo estático y no llega acá).
 *
 * Solo las carpetas cuyas URLs ya son públicas por diseño (adjuntos de Chat,
 * Track, tareas del CRM y capturas de Robots). Docs y Board pasan siempre por
 * sus rutas con chequeo de permisos (/api/docs/files, /api/boards/.../files).
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const { path } = await props.params;
  return localUploadResponse(path);
}
