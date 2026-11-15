/**
 * Al arrancar el servidor: Cache-Control por defecto en /api/*, y (self-host
 * sin Blob) mueve las subidas que
 * versiones anteriores dejaban en public/uploads a UPLOADS_DIR, fuera de
 * public/. Las URLs guardadas no cambian.
 */
export async function register() {
  // NEXT_RUNTIME se reemplaza al compilar: el bundle de edge no ve lib/uploads (fs).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Toda respuesta de /api/* sin Cache-Control propia sale `private, no-store` (lib/api-cache-default.ts).
    const { ServerResponse } = await import('http');
    const { installApiCacheDefault } = await import('./lib/api-cache-default');
    installApiCacheDefault(ServerResponse.prototype);
    if (process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN) return;
    const { migrateLegacyUploads } = await import('./lib/uploads');
    await migrateLegacyUploads().catch(() => undefined);
  }
}
