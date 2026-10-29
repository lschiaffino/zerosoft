/** Cuerpo multipart (puro, Node). */

/** multipart/form-data a mano (Buffer): el fetch de Electron no siempre serializa FormData con archivos. */
export function multipartBody(fields: Record<string, string>, file: { name: string; field: string; type: string; data: Uint8Array }): { body: Buffer; contentType: string } {
  const boundary = `----zerosoft${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const parts: Buffer[] = [];
  const safe = (v: string) => v.replace(/[\r\n"]/g, ' ');
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safe(k)}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safe(file.field)}"; filename="${safe(file.name)}"\r\nContent-Type: ${safe(file.type)}\r\n\r\n`),
    Buffer.from(file.data),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}
